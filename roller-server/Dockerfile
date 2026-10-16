# 构建阶段
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# 先只拷 csproj 做 restore，利用镜像层缓存加速后续构建
COPY RandomGroup.Api/RandomGroup.Api.csproj RandomGroup.Api/
RUN dotnet restore RandomGroup.Api/RandomGroup.Api.csproj

COPY . .
RUN dotnet publish RandomGroup.Api/RandomGroup.Api.csproj \
    -c Release \
    -o /app/publish \
    --no-restore \
    /p:UseAppHost=false

# 运行阶段
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# 以非 root 运行
RUN useradd -m -u 10001 appuser
USER appuser

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
ENV DOTNET_EnableDiagnostics=0

EXPOSE 8080

ENTRYPOINT ["dotnet", "RandomGroup.Api.dll"]
