/**
 * 数据层（统一入口）
 * ---------------------------------------------------------------
 * 页面只 require 这一个文件。具体走云服务还是自建服务，由
 * utils/config.js 里的 DATA_SOURCE 决定：
 *
 *   'cloud'  -> utils/store-cloud.js   微信云服务（当前默认）
 *   'server' -> utils/store-http.js    自建 ASP.NET Core + PostgreSQL（保留备用）
 *
 * 两套实现的方法名与返回结构完全一致，所以页面代码里没有任何区分逻辑，
 * 以后想切回自建服务，只要把 DATA_SOURCE 改成 'server' 并填好 baseUrl。
 */

const config = require('./config')

const impl = config.dataSource === 'server'
  ? require('./store-http')
  : require('./store-cloud')

module.exports = impl
