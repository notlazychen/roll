using Microsoft.EntityFrameworkCore;
using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Infrastructure;

namespace RandomGroup.Api.Features;

/// <summary>
/// 头像上传：小程序用官方「头像昵称填写能力」拿到临时图片后，先在本地压到 240px JPEG，
/// 再以 base64 提交（不用 multipart —— 少一次表单/防伪校验的坑，体积也就几十 KB）。
/// </summary>
public record UploadAvatarRequest(string? ImageBase64, string? ContentType);

public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this IEndpointRouteBuilder app)
    {
        // 上传或更换头像。成功后返回新的头像地址（版本号已自增，可用来刷掉缓存）
        app.MapPost("/api/me/avatar", async (
            UploadAvatarRequest req,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var uid = ctx.User.GetUserId();

            var base64 = AvatarUrls.StripDataUriPrefix(req.ImageBase64);
            if (string.IsNullOrWhiteSpace(base64))
                throw ApiException.BadRequest("缺少头像数据");

            byte[] bytes;
            try
            {
                bytes = Convert.FromBase64String(base64);
            }
            catch (FormatException)
            {
                throw ApiException.BadRequest("头像数据不是合法的 base64");
            }

            if (bytes.Length == 0) throw ApiException.BadRequest("头像数据为空");
            if (bytes.Length > AvatarUrls.MaxBytes)
                throw ApiException.BadRequest($"头像不能超过 {AvatarUrls.MaxBytes / 1024}KB，请换一张小一点的图片");

            var contentType = AvatarUrls.SniffContentType(bytes)
                ?? throw ApiException.BadRequest("只支持 JPG / PNG / WebP 格式的图片");

            var user = await db.Users.FirstOrDefaultAsync(u => u.Id == uid, ct)
                ?? throw ApiException.Unauthorized("账号不存在，请重新登录");

            user.AvatarData = bytes;
            user.AvatarContentType = contentType;
            user.AvatarVersion += 1;
            await db.SaveChangesAsync(ct);

            return Results.Json(new
            {
                ok = true,
                avatarUrl = AvatarUrls.For(user),
                bytes = bytes.Length
            });
        }).WithTags("认证");

        // 读取头像。
        // 必须匿名可访问：小程序 <image src> 不会带 Authorization 头。
        // URL 里带自增版本号，换头像后地址就变了，客户端和微信的图片缓存会自动失效。
        app.MapGet("/api/users/{id:long}/avatar", async (
            long id,
            HttpContext ctx,
            RollDbContext db,
            CancellationToken ct) =>
        {
            var row = await db.Users.AsNoTracking()
                .Where(u => u.Id == id)
                .Select(u => new { u.AvatarData, u.AvatarContentType })
                .FirstOrDefaultAsync(ct);

            if (row?.AvatarData is not { Length: > 0 })
                return Results.NotFound();

            // 地址里带版本号，同一个地址的内容永不改变，所以可以放心长缓存
            ctx.Response.Headers.CacheControl = "public, max-age=31536000, immutable";

            return Results.File(
                row.AvatarData,
                contentType: row.AvatarContentType ?? AvatarUrls.DefaultContentType);
        })
        .AllowAnonymous()
        .WithTags("认证");
    }
}
