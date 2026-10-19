using RandomGroup.Api.Contracts;
using RandomGroup.Api.Data;
using RandomGroup.Api.Services;

namespace RandomGroup.Api.Features;

/// <summary>实体 ↔ DTO 的转换集中在这里，避免每个接口各写一遍。</summary>
public static class EntryMapper
{
    public static EntryDto ToDto(LedgerEntry e) => new(
        e.Id, e.Type, e.Amount, e.Category, e.Channel, e.Consumer, e.Account,
        e.TradeAt.ToUnixTimeMilliseconds(), e.CreatedAt.ToUnixTimeMilliseconds(),
        e.Remark, TagService.ParseTags(e.TagsJson));
}
