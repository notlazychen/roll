/**
 * 头像读取工具
 * ---------------------------------------------------------------
 * 微信官方的「头像昵称填写能力」给到的是**本地临时文件路径**
 * （<button open-type="chooseAvatar"> 的 e.detail.avatarUrl），
 * 既不能直接当 URL 用，也不会自己持久化。
 *
 * 所以流程是：压缩 → 读成 base64 → 交给服务端存库 → 服务端回一个可长期访问的地址。
 * 压到 240px JPEG 后一般 10~30KB，base64 后约 40KB，走 JSON 提交完全够用。
 */

/** 压缩（失败就退回原图，不让压缩成为阻断点） */
function compress(srcPath) {
  return new Promise(function (resolve) {
    if (typeof wx.compressImage !== 'function') return resolve(srcPath)
    wx.compressImage({
      src: srcPath,
      quality: 60,
      compressedWidth: 240,
      compressedHeight: 240,
      success: function (r) { resolve((r && r.tempFilePath) || srcPath) },
      fail: function () { resolve(srcPath) }
    })
  })
}

function readBase64(filePath) {
  return new Promise(function (resolve, reject) {
    wx.getFileSystemManager().readFile({
      filePath: filePath,
      encoding: 'base64',
      success: function (r) { resolve(r && r.data) },
      fail: function (e) { reject(new Error((e && e.errMsg) || '读取头像失败')) }
    })
  })
}

/** 服务端会按文件头重新判断类型，这里只做个尽量准确的提示 */
function contentTypeOf(path) {
  const p = String(path || '').toLowerCase()
  if (p.indexOf('.png') >= 0) return 'image/png'
  if (p.indexOf('.webp') >= 0) return 'image/webp'
  return 'image/jpeg'
}

/**
 * 临时文件 → { ok, base64, contentType }（失败时返回 { ok:false, error }）
 */
async function toBase64(srcPath) {
  if (!srcPath) return { ok: false, error: '没有选择头像' }
  try {
    const filePath = await compress(srcPath)
    const base64 = await readBase64(filePath)
    if (!base64) return { ok: false, error: '读取头像失败' }
    return { ok: true, base64: base64, contentType: contentTypeOf(filePath) }
  } catch (e) {
    return { ok: false, error: (e && e.message) || '读取头像失败' }
  }
}

module.exports = {
  toBase64,
  compress,
  contentTypeOf
}
