using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi;
using RandomGroup.Api.Data;
using RandomGroup.Api.Features;
using RandomGroup.Api.Infrastructure;
using RandomGroup.Api.Services;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;
var isDev = builder.Environment.IsDevelopment();

/* --------------------------- 数据库（PostgreSQL） --------------------------- */

var connectionString = config.GetConnectionString("Roll");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "缺少 PostgreSQL 连接串。请在 appsettings.json 里配置 ConnectionStrings:Roll，" +
        "或设置环境变量 ConnectionStrings__Roll（生产环境推荐用环境变量）。");
}

builder.Services.AddDbContext<RollDbContext>(options =>
{
    // 这里刻意不开启 EnableRetryOnFailure：
    // 它会安装 NpgsqlRetryingExecutionStrategy，而该策略不支持我们自己发起的事务
    // （加入小队、添加备选项等都需要显式事务）。相比"自动重试"，这些场景更需要
    // 明确的事务语义，避免半提交后重试产生重复数据。
    options.UseNpgsql(connectionString, npgsql => npgsql.CommandTimeout(120));
    options.UseSnakeCaseNamingConvention();
    if (isDev) options.EnableSensitiveDataLogging().EnableDetailedErrors();
});

/* --------------------------- 配置项 --------------------------- */

builder.Services.Configure<JwtOptions>(config.GetSection("Jwt"));
builder.Services.Configure<WeChatOptions>(config.GetSection("WeChat"));
builder.Services.Configure<AuthOptions>(config.GetSection("Auth"));
builder.Services.Configure<MailOptions>(config.GetSection("Mail"));

/* --------------------------- 业务服务 --------------------------- */

builder.Services.AddScoped<OptionSourceService>();
builder.Services.AddScoped<TagService>();
builder.Services.AddScoped<AccountService>();
builder.Services.AddSingleton<AccountService.LoginThrottle>();
builder.Services.AddSingleton<AccountLinkService>();
builder.Services.AddSingleton<MailSender>();
builder.Services.AddSingleton<EmailCodeService>();
builder.Services.AddSingleton<TokenService>();
builder.Services.AddHttpClient<WeChatClient>(c => c.Timeout = TimeSpan.FromSeconds(10));

/* --------------------------- 鉴权（JWT） --------------------------- */

var jwt = config.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
if (string.IsNullOrWhiteSpace(jwt.Key) || jwt.Key.Length < 32)
{
    throw new InvalidOperationException(
        "Jwt:Key 未配置或长度不足 32 位。请在配置或环境变量 Jwt__Key 中设置一个足够长的随机字符串。");
}

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(2)
        };

        // 未登录 / token 失效也返回统一 JSON，小程序端可据此自动重新登录
        options.Events = new JwtBearerEvents
        {
            OnChallenge = async context =>
            {
                context.HandleResponse();
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/json; charset=utf-8";
                await context.Response.WriteAsJsonAsync(new { ok = false, error = "登录状态已失效，请重新登录" });
            },
            OnForbidden = async context =>
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.ContentType = "application/json; charset=utf-8";
                await context.Response.WriteAsJsonAsync(new { ok = false, error = "没有权限执行该操作" });
            }
        };
    });

// 默认全部接口都需要登录，个别接口用 AllowAnonymous 放开
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

/* --------------------------- 其它 --------------------------- */

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "记账 API",
        Version = "v1",
        Description = "贴身小工具 · 记账：账目明细、收支报表、选项源维护"
    });

    c.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "先调用 /api/auth/wechat 或（开发环境）/api/auth/dev 拿到 token，填在这里。"
    });

    c.AddSecurityRequirement(doc => new OpenApiSecurityRequirement
    {
        [new OpenApiSecuritySchemeReference("Bearer", doc)] = new List<string>()
    });
});

/* --------------------------- CORS（跨域访问） --------------------------- */
//
// 线上是「单域名同源」部署：Web 前端和 /api 都在 roll.acgun.cn，
// 浏览器根本不会触发跨域，所以生产环境的 CORS 其实用不上。
//
// 那为什么还留着？
//   · 本地开发：前端跑在 5173，接口在 5235，必须允许跨域
//   · 万一以后把前端挪到 CDN 或别的子域，改配置即可，不用改代码
//
// 白名单走配置 Cors:Origins（数组）；不配置时：
//   · 开发环境放开任意来源（方便本地随意切端口）
//   · 生产环境回落到内置的正式域名，避免「忘了配就全站调不通」
var corsOrigins = config.GetSection("Cors:Origins").Get<string[]>() ?? Array.Empty<string>();
if (corsOrigins.Length == 0 && !isDev)
{
    corsOrigins = new[] { "https://roll.acgun.cn" };
}

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
{
    if (isDev || corsOrigins.Length == 0)
    {
        // AllowAnyOrigin 与 AllowCredentials 不能同时用，这里本来也不依赖 Cookie
        p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    }
    else
    {
        p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod();
    }
}));

builder.Services.AddHealthChecks();

var app = builder.Build();

/* --------------------------- 中间件 --------------------------- */

app.UseMiddleware<ApiExceptionMiddleware>();

// CORS 必须排在 UseAuthentication/UseAuthorization 之前，
// 否则预检请求（OPTIONS）会先被鉴权的 401 拦下来
app.UseCors();

if (isDev)
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "记账 API v1"));
}

app.UseAuthentication();
app.UseAuthorization();

/* --------------------------- 启动时自动建表 --------------------------- */

if (config.GetValue("Database:AutoMigrate", false))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<RollDbContext>();
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    try
    {
        await db.Database.MigrateAsync();
        logger.LogInformation("数据库迁移已完成");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "数据库迁移失败，请检查连接串与数据库权限");
        throw;
    }
}

/* --------------------------- 路由 --------------------------- */

app.MapHealthChecks("/health").AllowAnonymous();
app.MapAuthEndpoints();
app.MapAccountSecurityEndpoints();
app.MapWebQrLoginEndpoints();
app.MapEntryEndpoints();
app.MapTodoEndpoints();
app.MapOptionEndpoints();
app.MapReportEndpoints();

app.Run();

/// <summary>供集成测试引用</summary>
public partial class Program { }
