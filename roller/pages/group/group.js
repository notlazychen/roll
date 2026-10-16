const store = require('../../utils/store')
const util = require('../../utils/util')

const WHEEL_COLORS = util.WHEEL_COLORS

// 本次会话内已播放过动画的结果标记（resultAt -> true），避免重复播放
const played = {}

const DEADLINE_OPTIONS = [
  { v: 60, label: '1 分钟' },
  { v: 180, label: '3 分钟' },
  { v: 300, label: '5 分钟' },
  { v: 600, label: '10 分钟' },
  { v: 0, label: '不限时' }
]

Page({
  data: {
    groupId: 0,
    group: null,
    me: null,
    members: [],
    options: [],
    isLeader: false,
    isMember: false,
    isFull: false,
    // 是否处于开发模式（服务端允许用测试身份登录），决定是否显示"加成员/切身份"入口
    devMode: store.isDevMode(),

    stage: 'config',
    myReady: 'none',
    confirmedCount: 0,
    countdown: '',
    hasDeadline: false,

    weights: { items: [], totalVotes: 0, uniform: false },
    resultOption: null,

    wheelVisible: false,
    canvasOff: false,
    spinning: false,

    // 编辑态
    showThemeEditor: false,
    themeInput: '',
    showPasscodeSheet: false,
    passInput: '',
    showDeadlineSheet: false,
    deadlineChoice: 180,
    deadlineOptions: DEADLINE_OPTIONS,
    showIdentitySheet: false,
    identities: [],
    newIdentityName: '',
    newOption: ''
  },

  /* ================= 生命周期 ================= */

  onLoad(options) {
    const gid = Number(options && options.id)
    if (!gid) {
      util.toast('小队参数有误')
      wx.navigateBack()
      return
    }
    this.setData({ groupId: gid })
    this.reload()
    this.startTimer()
  },

  onShow() {
    if (this.data.groupId) this.reload()
  },

  onHide() {
    this.stopTimer()
  },

  onUnload() {
    this.stopTimer()
  },

  startTimer() {
    this.stopTimer()
    this._timer = setInterval(() => {
      this.tick()
    }, 1000)
  },

  stopTimer() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  },

  async tick() {
    this.updateCountdown()
    this.run()
  },

  reload() {
    this.run()
  },

  async run() {
    if (this._busy) {
      this._pending = true
      return
    }
    this._busy = true
    try {
      // 最多连锁推进 4 次（准备超时 -> 随机 -> 结果）
      for (let i = 0; i < 4; i++) {
        const changed = await this.loadOnce()
        if (!changed) break
      }
    } catch (e) {
      // 静默：下一 tick 会自动重试
    }
    this._busy = false
    if (this._pending) {
      this._pending = false
      this.run()
    }
  },

  updateCountdown() {
    const g = this.data.group
    if (!g || g.stage !== 'preparing') return
    if (!g.prepDeadline) {
      if (this.data.countdown !== '不限时') this.setData({ countdown: '不限时' })
      return
    }
    const txt = util.countdownText(g.prepDeadline - Date.now())
    if (txt !== this.data.countdown) this.setData({ countdown: txt })
  },

  /* ================= 数据加载与阶段推进 ================= */

  /** 返回 true 表示发生了阶段流转，需要再加载一次 */
  async loadOnce() {
    const gid = this.data.groupId
    const me = store.getMe()
    me.color = util.colorOf(me.uid)
    me.initial = util.initialOf(me.name)

    // 这一趟请求服务端就会推进阶段（超时 / 全员确认），并返回最新快照，
    // 所以轮询只需要 1 个请求，而不是原来的 4 个。
    const bundle = await store.loadGroupBundle(gid)
    if (!bundle || !bundle.ok) {
      const missing = bundle && /不存在/.test(bundle.error || '')
      if (missing) {
        util.toast('小队不存在或已被解散')
        this.stopTimer()
        wx.navigateBack()
      }
      // 网络异常时保留页面，下一个 tick 会自动重试
      return false
    }

    const group = bundle.group
    const memberRows = bundle.members || []
    const optionRows = bundle.options || []
    const wres = bundle.weights || { items: [], totalVotes: 0, uniform: false }

    const isMember = !!bundle.isMember
    const mine = memberRows.filter(function (m) { return m.uid === me.uid })[0]
    const isLeader = !!bundle.isLeader
    const confirmed = memberRows.filter(function (m) { return m.ready === 'confirm' }).length

    const members = memberRows.map(function (m) {
      return {
        id: m.id,
        uid: m.uid,
        name: m.uid === me.uid ? '我' : m.name,
        rawName: m.name,
        ready: m.ready,
        isMe: m.uid === me.uid,
        isLeader: m.uid === group.ownerId,
        color: util.colorOf(m.uid),
        initial: util.initialOf(m.name),
        dotClass: m.ready === 'confirm' ? 'dot-ok' : (m.ready === 'cancel' ? 'dot-no' : 'dot-wait')
      }
    })

    const options = optionRows.map(function (o) {
      return {
        id: o.id,
        title: o.title,
        creatorId: o.creatorId,
        creatorName: o.creatorId === me.uid ? '我' : o.creatorName,
        voteCount: o.voteCount,
        votedByMe: o.voters.indexOf(me.uid) >= 0,
        canDelete: o.creatorId === me.uid
      }
    })

    const items = wres.items.map(function (it) {
      return {
        optionId: it.optionId,
        title: it.title,
        votes: it.votes,
        weight: it.weight,
        percent: it.percent,
        pctText: Math.round(it.percent * 100) + '%',
        colorIndex: it.colorIndex,
        color: WHEEL_COLORS[it.colorIndex % WHEEL_COLORS.length]
      }
    })

    const colorMap = {}
    items.forEach(function (it) { colorMap[it.optionId] = it.color })
    options.forEach(function (o) { o.color = colorMap[o.id] || '#D9DAE6' })

    let resultOption = null
    if (group.stage === 'result' && group.resultOptionId) {
      const o = options.filter(function (x) { return x.id === group.resultOptionId })[0]
      const w = items.filter(function (x) { return x.optionId === group.resultOptionId })[0]
      if (o) {
        resultOption = {
          title: o.title,
          creatorName: o.creatorName,
          votes: o.voteCount,
          pctText: w ? w.pctText : '—'
        }
      }
    }

    const hasDeadline = !!group.prepDeadline
    this.setData({
      me: me,
      group: group,
      members: members,
      options: options,
      isMember: isMember,
      isLeader: isLeader,
      isFull: members.length >= store.MAX_MEMBERS,
      stage: group.stage,
      myReady: mine ? mine.ready : 'none',
      confirmedCount: confirmed,
      hasDeadline: hasDeadline,
      countdown: group.stage === 'preparing'
        ? (hasDeadline ? util.countdownText(group.prepDeadline - Date.now()) : '不限时')
        : '',
      weights: { items: items, totalVotes: wres.totalVotes, uniform: wres.uniform },
      resultOption: resultOption
    })

    this.updateCountdown()

    // ---- 阶段推进：全部由服务端裁决，这里只负责界面切换 ----
    if (group.stage === 'preparing') {
      // 超时与全员确认都由服务端在读取时自动处理，界面只需展示倒计时
      if (this.data.wheelVisible) this.hideWheel()
      return false
    }

    if (group.stage === 'rolling') {
      // 正常情况下服务端会在同一次请求里直接给出结果，这里是兜底分支
      if (this.data.wheelVisible) this.hideWheel()
      if (this._rollPending) return false
      this._rollPending = true
      const res = await store.rollPick(gid)
      this._rollPending = false
      if (res && res.pending) return false
      if (!res.ok && res.error) util.toast(res.error)
      return true
    }

    if (group.stage === 'result' && group.resultOptionId) {
      const key = String(group.resultAt)
      if (played[key]) {
        this.showWheelStatic(group.resultOptionId, key)
      } else {
        played[key] = true
        this.startSpin(group.resultOptionId)
      }
      return false
    }

    // config
    if (this.data.wheelVisible) this.hideWheel()
    return false
  },

  /* ================= 转盘绘制 ================= */

  getCanvas() {
    if (this._cv) return Promise.resolve(this._cv)
    if (this._cvPromise) return this._cvPromise
    const that = this
    this._cvPromise = new Promise(function (resolve) {
      wx.createSelectorQuery()
        .in(that)
        .select('#wheel')
        .fields({ node: true, size: true })
        .exec(function (res) {
          const item = res && res[0]
          if (!item || !item.node) {
            // 查询失败不缓存，下次重试（节点可能尚未挂载完成）
            that._cvPromise = null
            resolve(null)
            return
          }
          const canvas = item.node
          const ctx = canvas.getContext('2d')
          let dpr = 2
          try {
            if (typeof wx.getWindowInfo === 'function') dpr = wx.getWindowInfo().pixelRatio || 2
            else if (typeof wx.getSystemInfoSync === 'function') dpr = wx.getSystemInfoSync().pixelRatio || 2
          } catch (e) {}
          canvas.width = item.width * dpr
          canvas.height = item.height * dpr
          const cv = { canvas: canvas, ctx: ctx, w: item.width, h: item.height, dpr: dpr }
          that._cv = cv
          resolve(cv)
        })
    })
    return this._cvPromise
  },

  hideWheel() {
    this._cv = null
    this._cvPromise = null
    this._drawnKey = null
    this._mounting = false
    this.setData({ wheelVisible: false, canvasOff: false, spinning: false })
  },

  setCanvasOff(off) {
    if (off && this.data.spinning) return
    if (this.data.canvasOff === !!off) return
    this.setData({ canvasOff: !!off })
  },

  /**
   * 原生 canvas 的统一挂载入口。
   * 原生组件层在「刚挂载 + 上方布局同时变化（wx:if 切换）」时可能不按
   * 最终布局定位，表现为转盘飘到页面顶部、压住小队卡片。
   * 这里统一走：先卸载 -> 等布局稳定 -> 重新挂载 -> 重新查询节点 -> 再绘制。
   */
  mountCanvasThenDraw(drawFn, resetScroll) {
    const that = this
    if (this._mounting) return
    this._mounting = true
    if (resetScroll) {
      wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    }
    const doMount = function () {
      // 节点重建后必须重新查询，旧引用已失效
      that._cv = null
      that._cvPromise = null
      that.setData({ canvasOff: false }, function () {
        // 再等一帧，等原生组件按最终布局完成定位
        setTimeout(function () {
          that.getCanvas().then(function (cv) {
            that._mounting = false
            // 即使查询失败也回调，让调用方有机会复位 spinning 等状态
            if (drawFn) drawFn()
          })
        }, 60)
      })
    }
    if (this.data.canvasOff) {
      wx.nextTick(function () { setTimeout(doMount, 50) })
    } else {
      // 先卸载现有节点，强制原生层按新布局重新定位
      that.setData({ canvasOff: true }, function () {
        wx.nextTick(function () { setTimeout(doMount, 50) })
      })
    }
  },

  /** 弹层关闭后恢复转盘绘制 */
  restoreWheelCanvas() {
    if (!this.data.canvasOff) return
    const that = this
    const g = this.data.group
    if (!this.data.wheelVisible || !g || g.stage !== 'result' || !g.resultOptionId) {
      // 转盘本来就不可见（或已不在结果阶段）时无需恢复
      return
    }
    const key = String(g.resultAt)
    const target = that.computeTarget(g.resultOptionId)
    this._drawnKey = key
    this.mountCanvasThenDraw(function () {
      that.drawWheel(target)
    })
  },

  showWheelStatic(optionId, key) {
    const wasVisible = this.data.wheelVisible
    // 挂载中 / 播放动画中 / 已画好 / 弹层打开期间（canvasOff，关闭时由 restoreWheelCanvas 恢复）都不重复挂载
    if (wasVisible && (this._mounting || this.data.spinning || this._cv || this.data.canvasOff)) return
    const that = this
    const target = this.computeTarget(optionId)
    this._drawnKey = key
    this.setData({ wheelVisible: true, spinning: false })
    this.mountCanvasThenDraw(function () {
      that.drawWheel(target)
    }, !wasVisible)
  },

  startSpin(optionId) {
    const that = this
    const wasVisible = this.data.wheelVisible
    this._drawnKey = String(this.data.group && this.data.group.resultAt)
    this.setData({ wheelVisible: true, spinning: true })
    this.mountCanvasThenDraw(function () {
      const cv = that._cv
      if (!cv) {
        that.setData({ spinning: false })
        return
      }
      const target = that.computeTarget(optionId)
      that.drawWheel(0)
      that.animateTo(target, 3400, function () {
        that.setData({ spinning: false })
        util.haptic()
      })
    }, !wasVisible)
  },

  computeTarget(optionId) {
    const items = (this.data.weights && this.data.weights.items) || []
    const pool = items.filter(function (i) { return i.weight > 0 })
    const sum = pool.reduce(function (s, i) { return s + i.weight }, 0)
    if (!sum) return Math.PI * 2 * 5
    let a = -Math.PI / 2
    let center = null
    for (let i = 0; i < pool.length; i++) {
      const sweep = Math.PI * 2 * (pool[i].weight / sum)
      if (pool[i].optionId === optionId) {
        // 在扇区内随机落点，让结果更自然（仍保证落在该扇区内）
        center = a + sweep * (0.22 + Math.random() * 0.56)
        break
      }
      a += sweep
    }
    if (center === null) return Math.PI * 2 * 5
    let rot = -Math.PI / 2 - center
    rot = ((rot % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    return Math.PI * 2 * 5 + rot
  },

  drawWheel(rotation) {
    const cv = this._cv
    if (!cv) return
    const ctx = cv.ctx
    const w = cv.w
    const h = cv.h
    const cx = w / 2
    const cy = h / 2
    const r = Math.min(w, h) / 2 - 32
    const items = (this.data.weights && this.data.weights.items) || []
    const pool = items.filter(function (i) { return i.weight > 0 })

    // 每次重绘都重置变换矩阵（避免反复 scale 叠加）
    ctx.setTransform(cv.dpr || 1, 0, 0, cv.dpr || 1, 0, 0)
    ctx.clearRect(0, 0, w, h)

    // 底盘
    ctx.beginPath()
    ctx.arc(cx, cy, r + 14, 0, Math.PI * 2)
    ctx.fillStyle = '#F1F0FB'
    ctx.fill()

    // 扇形
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rotation || 0)
    const sum = pool.reduce(function (s, i) { return s + i.weight }, 0)
    if (sum > 0) {
      let a = -Math.PI / 2
      for (let i = 0; i < pool.length; i++) {
        const sweep = Math.PI * 2 * (pool[i].weight / sum)
        ctx.beginPath()
        ctx.moveTo(0, 0)
        ctx.arc(0, 0, r, a, a + sweep)
        ctx.closePath()
        ctx.fillStyle = pool[i].color
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = '#FFFFFF'
        ctx.stroke()
        a += sweep
      }
    } else {
      ctx.beginPath()
      ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.fillStyle = '#E9EAF2'
      ctx.fill()
    }
    ctx.restore()

    // 中心
    ctx.beginPath()
    ctx.arc(cx, cy, r * 0.2, 0, Math.PI * 2)
    ctx.fillStyle = '#FFFFFF'
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = '#EDECFA'
    ctx.stroke()

    // 指针（固定指向 12 点）
    ctx.beginPath()
    ctx.moveTo(cx - 17, cy - r - 22)
    ctx.lineTo(cx + 17, cy - r - 22)
    ctx.lineTo(cx, cy - r + 18)
    ctx.closePath()
    ctx.fillStyle = '#1F2233'
    ctx.fill()
  },

  animateTo(target, duration, done) {
    const cv = this._cv
    if (!cv || !cv.canvas || typeof cv.canvas.requestAnimationFrame !== 'function') {
      this.drawWheel(target)
      if (done) done()
      return
    }
    const that = this
    const start = Date.now()
    const tick = function () {
      const t = Math.min(1, (Date.now() - start) / duration)
      const e = 1 - Math.pow(1 - t, 3)
      that.drawWheel(target * e)
      if (t < 1) cv.canvas.requestAnimationFrame(tick)
      else if (done) done()
    }
    cv.canvas.requestAnimationFrame(tick)
  },

  /* ================= 顶部操作 ================= */

  goBack() {
    wx.navigateBack()
  },

  openMenu() {
    const that = this
    const list = ['复制小队号', '修改小队主题', '设置小队口令', this.data.isLeader ? '解散小队' : '退出小队']
    wx.showActionSheet({
      itemList: list,
      success(res) {
        const i = res.tapIndex
        if (i === 0) {
          wx.setClipboardData({
            data: String(that.data.group.code),
            success() { util.toast('小队号已复制') }
          })
        } else if (i === 1) {
          that.openThemeEditor()
        } else if (i === 2) {
          that.openPasscodeSheet()
        } else if (i === 3) {
          that.confirmExit()
        }
      },
      fail() {}
    })
  },

  confirmExit() {
    const that = this
    const isLeader = this.data.isLeader
    wx.showModal({
      title: isLeader ? '解散小队' : '退出小队',
      content: isLeader
        ? '解散后小队、备选项与投票记录将全部删除，且无法恢复。'
        : '退出后你的投票会被清除，可重新加入。',
      confirmText: isLeader ? '解散' : '退出',
      confirmColor: '#FF5A5F',
      success: async function (res) {
        if (!res.confirm) return
        if (isLeader) await store.deleteGroup(that.data.groupId)
        else await store.leaveGroup(that.data.groupId)
        util.toast(isLeader ? '已解散' : '已退出')
        that.stopTimer()
        setTimeout(function () { wx.navigateBack() }, 300)
      }
    })
  },

  /* ---------- 主题 ---------- */

  openThemeEditor() {
    if (!this.data.isLeader) return util.toast('只有小队长可以修改主题')
    this.setCanvasOff(true)
    this.setData({ showThemeEditor: true, themeInput: this.data.group.theme })
  },
  closeThemeEditor() {
    this.setData({ showThemeEditor: false })
    this.restoreWheelCanvas()
  },
  onThemeInput(e) {
    this.setData({ themeInput: e.detail.value })
  },
  async saveTheme() {
    const res = await store.updateGroup(this.data.groupId, { theme: this.data.themeInput })
    if (!res.ok) return util.toast(res.error || '修改失败')
    this.setData({ showThemeEditor: false })
    this.restoreWheelCanvas()
    util.toast('已保存')
    this.reload()
  },

  /* ---------- 口令 ---------- */

  openPasscodeSheet() {
    if (!this.data.isLeader) return util.toast('只有小队长可以设置口令')
    this.setCanvasOff(true)
    this.setData({ showPasscodeSheet: true, passInput: this.data.group.passcode || '' })
  },
  closePasscodeSheet() {
    this.setData({ showPasscodeSheet: false })
    this.restoreWheelCanvas()
  },
  onPassInput(e) {
    this.setData({ passInput: String(e.detail.value).replace(/\D/g, '').slice(0, 5) })
  },
  async savePasscode() {
    const p = String(this.data.passInput || '').trim()
    if (p && !/^\d{5}$/.test(p)) return util.toast('口令必须是 5 位数字')
    const res = await store.updateGroup(this.data.groupId, { passcode: p })
    if (!res.ok) return util.toast(res.error || '保存失败')
    this.setData({ showPasscodeSheet: false })
    this.restoreWheelCanvas()
    util.toast(p ? '口令已设置' : '口令已取消')
    this.reload()
  },

  /* ---------- 开始随机 ---------- */

  openDeadlineSheet() {
    if (!this.data.isLeader) return
    if (this.data.options.length === 0) return util.toast('请先添加备选项')
    this.setCanvasOff(true)
    this.setData({ showDeadlineSheet: true, deadlineChoice: 180 })
  },
  closeDeadlineSheet() {
    this.setData({ showDeadlineSheet: false })
    this.restoreWheelCanvas()
  },
  pickDeadline(e) {
    this.setData({ deadlineChoice: Number(e.currentTarget.dataset.v) })
  },
  async startRoll() {
    const v = Number(this.data.deadlineChoice)
    // 直接传秒数，由服务端按自己的时钟计算截止时间，避免客户端时钟不准
    const res = await store.startPrepare(this.data.groupId, v > 0 ? v : null)
    if (!res.ok) return util.toast(res.error || '开启失败')
    util.haptic()
    this.setData({ showDeadlineSheet: false })
    this.restoreWheelCanvas()
    this.reload()
  },

  /* ---------- 准备环节 ---------- */

  async onConfirmReady() {
    util.haptic()
    const res = await store.confirmReady(this.data.groupId)
    if (!res.ok) return util.toast(res.error || '操作失败')
    this.reload()
  },

  async onCancelReady() {
    const that = this
    wx.showModal({
      title: '取消准备',
      content: '取消将中断本次随机，并通知小队长。确定取消吗？',
      confirmText: '取消准备',
      confirmColor: '#FF5A5F',
      cancelText: '继续等待',
      success: async function (r) {
        if (!r.confirm) return
        await store.cancelReady(that.data.groupId)
        util.toast('已取消本次准备')
        that.reload()
      }
    })
  },

  /* ---------- 结果操作 ---------- */

  async onReroll() {
    this.openDeadlineSheet()
  },

  async onBackToConfig() {
    await store.backToConfig(this.data.groupId)
    util.toast('已回到配置')
    this.reload()
  },

  /* ---------- 备选项 ---------- */

  onNewOption(e) {
    this.setData({ newOption: e.detail.value })
  },

  async submitOption() {
    const t = String(this.data.newOption || '').trim()
    if (!t) return util.toast('请填写备选项内容')
    const res = await store.addOption(this.data.groupId, t)
    if (!res.ok) return util.toast(res.error || '添加失败')
    this.setData({ newOption: '' })
    util.haptic()
    util.toast('已添加，并自动投你一票')
    this.reload()
  },

  async onVote(e) {
    if (this.data.stage !== 'config') return util.toast('准备环节中已锁定投票')
    if (!this.data.isMember) return util.toast('请先加入小队')
    const id = Number(e.currentTarget.dataset.id)
    const res = await store.toggleVote(id)
    if (!res.ok) return util.toast(res.error || '操作失败')
    util.haptic()
    this.reload()
  },

  onDeleteOption(e) {
    const that = this
    const id = Number(e.currentTarget.dataset.id)
    if (this.data.stage !== 'config') return util.toast('当前阶段不可删除')
    wx.showModal({
      title: '删除备选项',
      content: '删除后该项的投票也会一并清除。',
      confirmText: '删除',
      confirmColor: '#FF5A5F',
      success: async function (r) {
        if (!r.confirm) return
        const res = await store.deleteOption(id)
        if (!res.ok) return util.toast(res.error || '删除失败')
        that.reload()
      }
    })
  },

  /* ---------- 我的资料 / 切换测试身份 ---------- */

  async openIdentity() {
    // 正式环境没有可切换的本地身份，入口直接进「我的」
    if (!this.data.devMode) {
      wx.navigateTo({ url: '/pages/me/me' })
      return
    }
    const identities = store.listIdentities()
    const me = store.getMe()
    // 直接用当前页面已有的成员列表判断是否已在组内，避免额外请求
    const joinedUids = (this.data.members || []).map(function (m) { return m.uid })
    const list = identities.map(function (i) {
      return {
        uid: i.uid,
        name: i.name,
        color: util.colorOf(i.uid),
        initial: util.initialOf(i.name),
        joined: joinedUids.indexOf(i.uid) >= 0,
        isMe: i.uid === me.uid
      }
    })
    this.setCanvasOff(true)
    this.setData({ showIdentitySheet: true, identities: list, newIdentityName: '' })
  },

  closeIdentity() {
    this.setData({ showIdentitySheet: false })
    this.restoreWheelCanvas()
  },

  onNewIdentityName(e) {
    this.setData({ newIdentityName: e.detail.value })
  },

  async onSwitchIdentity(e) {
    const uid = Number(e.currentTarget.dataset.uid)
    if (uid === this.data.me.uid) {
      this.closeIdentity()
      return
    }
    const ok = await store.switchIdentity(uid)
    if (!ok) return util.toast('切换身份失败')
    this.closeIdentity()
    util.toast('已切换为「' + (store.getMe().name || '') + '」')
    this.reload()
  },

  /** 新建一个测试身份并直接加入当前小队（仅开发模式可用） */
  async addAndJoin() {
    const name = String(this.data.newIdentityName || '').trim()
    if (!name) return util.toast('请输入成员昵称')
    const item = await store.addIdentity(name)
    if (!item) return util.toast('创建测试身份失败，请确认服务端已开启开发模式登录')
    const res = await store.joinGroup(this.data.groupId, {})
    this.setData({ showIdentitySheet: false, newIdentityName: '' })
    this.restoreWheelCanvas()
    if (!res.ok) util.toast(res.error || '已创建测试身份，但加入失败')
    else util.toast('已创建测试身份并加入')
    this.reload()
  },

  async joinCurrent() {
    const g = this.data.group
    let pass = ''
    if (g && g.hasPasscode) {
      const r = await new Promise(function (resolve) {
        wx.showModal({
          title: '输入小队口令',
          editable: true,
          placeholderText: '请输入 5 位数字口令',
          success: resolve,
          fail: function () { resolve({}) }
        })
      })
      if (!r || !r.confirm) return
      pass = String(r.content || '').trim()
    }
    const res = await store.joinGroup(this.data.groupId, { passcode: pass })
    if (!res.ok) return util.toast(res.error || '加入失败')
    util.toast('加入成功')
    this.reload()
  },

  goMessages() {
    wx.navigateTo({ url: '/pages/messages/messages' })
  },

  noop() {}
})
