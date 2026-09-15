/**
 * 传递舱演练器 —— 单一有限状态机（流程唯一真源）
 *
 * 唯一成功路径（8 个步骤严格按序）：
 *   外门开 → 放入物品 → 外门关 → 启动净化 → 确认净化完成
 *          → 内门开 → 取出物品 → 内门关
 *
 * 设计约束：
 *  - 全部流程规则只在本文件中裁决；阶段（stage）是唯一真源。
 *  - 门、物品、当前步骤、结果均为「裁决后状态」的纯投影（见 selectors），
 *    不另设任何独立的跨步骤约束 / 门联锁标志。
 *  - 双门互锁是阶段定义本身的推论：不存在两扇门同时投影为「开」的阶段。
 *  - 任一非法操作立即把本轮锁定为 `locked`；锁定后仅 reset 可改变状态。
 */

// ---- 阶段：FSM 的唯一状态维度 ---------------------------------------------

export type Stage =
  | 'idle' // 双门关闭、舱内为空，等待「外门开」
  | 'outerOpen' // 外门开（内门必关），等待「放入物品」
  | 'loadedOuterOpen' // 已放入物品，等待「外门关」
  | 'outerClosed' // 物品在舱、双门关，等待「启动净化」
  | 'purifying' // 净化进行中，等待「确认净化完成」
  | 'purified' // 净化完成、双门关，等待「内门开」
  | 'innerOpen' // 内门开（外门必关），物品尚在舱内，等待「取出物品」
  | 'unloadedInnerOpen' // 物品已取出，等待「内门关」
  | 'done' // 传递完成
  | 'locked' // 本轮因非法操作锁定（仅复位可退出）

// ---- 操作（面板提供的九种操作）--------------------------------------------

export type ActionKind =
  | 'openOuter' // 外门开
  | 'loadItem' // 放入物品
  | 'closeOuter' // 外门关
  | 'startPurification' // 启动净化
  | 'confirmPurification' // 确认净化完成
  | 'openInner' // 内门开
  | 'unloadItem' // 取出物品
  | 'closeInner' // 内门关
  | 'reset' // 复位

export interface LogEntry {
  /** 1 起始的操作序号 */
  seq: number
  action: ActionKind
  ok: boolean
  /** 该操作被执行时所处的阶段 */
  stage: Stage
  time: string
}

export interface MachineState {
  /** 单一真源：当前 FSM 阶段 */
  stage: Stage
  /** 已记录的操作数，同时作为下一条记录的序号 */
  stepCount: number
  /** 本轮操作记录 */
  log: LogEntry[]
  /** 锁定原因：记录期望步骤与实际操作 */
  violation: Violation | null
}

export interface Violation {
  /** 触发锁定的实际操作 */
  actual: ActionKind
  /** 该阶段唯一允许的下一步操作 */
  expected: ActionKind
  /** 锁定时所处的阶段 */
  stage: Stage
}

export const INITIAL_STATE: MachineState = {
  stage: 'idle',
  stepCount: 0,
  log: [],
  violation: null,
}

// ---- 操作 / 阶段的展示文案 -------------------------------------------------

export const ACTION_LABELS: Record<ActionKind, string> = {
  openOuter: '外门开',
  loadItem: '放入物品',
  closeOuter: '外门关',
  startPurification: '启动净化',
  confirmPurification: '确认净化完成',
  openInner: '内门开',
  unloadItem: '取出物品',
  closeInner: '内门关',
  reset: '复位',
}

/** 唯一成功路径上前置阶段 → 唯一合法操作（reset 始终独立合法） */
const LEGAL_TRANSITIONS: Partial<Record<Stage, ActionKind>> = {
  idle: 'openOuter',
  outerOpen: 'loadItem',
  loadedOuterOpen: 'closeOuter',
  outerClosed: 'startPurification',
  purifying: 'confirmPurification',
  purified: 'openInner',
  innerOpen: 'unloadItem',
  unloadedInnerOpen: 'closeInner',
}

/** 合法操作 → 下一阶段（成功路径的 8 次转移） */
const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  idle: 'outerOpen',
  outerOpen: 'loadedOuterOpen',
  loadedOuterOpen: 'outerClosed',
  outerClosed: 'purifying',
  purifying: 'purified',
  purified: 'innerOpen',
  innerOpen: 'unloadedInnerOpen',
  unloadedInnerOpen: 'done',
}

/** 成功路径上每个阶段对应的步骤序号（1–8），用于展示「当前步骤」 */
const STAGE_STEP: Partial<Record<Stage, number>> = {
  idle: 1,
  outerOpen: 2,
  loadedOuterOpen: 3,
  outerClosed: 4,
  purifying: 5,
  purified: 6,
  innerOpen: 7,
  unloadedInnerOpen: 8,
  done: 8,
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

function pushLog(
  state: MachineState,
  action: ActionKind,
  ok: boolean,
  stage: Stage,
): LogEntry[] {
  const entry: LogEntry = {
    seq: state.stepCount + 1,
    action,
    ok,
    stage,
    time: nowTime(),
  }
  return [...state.log, entry]
}

// ---- 裁决：纯函数，返回操作后的新状态 --------------------------------------

export function dispatch(state: MachineState, action: ActionKind): MachineState {
  // 复位在任何阶段（含锁定、完成）都合法：清空物品 / 进度 / 记录，
  // 恢复双门关闭；之后第一步只能再次打开外门（即回到 idle）。
  if (action === 'reset') {
    return { ...INITIAL_STATE }
  }

  // 已锁定：除复位外的任何操作都不得改变状态（也不再重复记录）。
  if (state.stage === 'locked') {
    return state
  }

  const expected = LEGAL_TRANSITIONS[state.stage]

  // done 之后没有合法的下一步操作；任何操作都越序。
  if (expected === undefined || action !== expected) {
    return {
      ...state,
      stage: 'locked',
      stepCount: state.stepCount + 1,
      log: pushLog(state, action, false, state.stage),
      violation: {
        actual: action,
        expected: expected ?? 'reset',
        stage: state.stage,
      },
    }
  }

  // 合法转移：推进阶段（阶段是唯一被写入的流程事实）。
  const nextStage = NEXT_STAGE[state.stage]!

  return {
    ...state,
    stage: nextStage,
    stepCount: state.stepCount + 1,
    log: pushLog(state, action, true, state.stage),
    violation: null,
  }
}

// ================= 投影：门 / 物品 / 步骤 / 结果全部派生自裁决后状态 ==========

export interface DoorState {
  outerOpen: boolean
  innerOpen: boolean
}

/** 双门状态投影：仅在各自的阶段投影为开，二者永不重叠（互锁）。 */
export function selectDoors(stage: Stage): DoorState {
  return {
    outerOpen: stage === 'outerOpen' || stage === 'loadedOuterOpen',
    innerOpen: stage === 'innerOpen' || stage === 'unloadedInnerOpen',
  }
}

/** 舱内物品投影：物品在「放入之后、取出之前」的各阶段位于舱内。 */
export function selectHasItem(stage: Stage): boolean {
  return (
    stage === 'loadedOuterOpen' ||
    stage === 'outerClosed' ||
    stage === 'purifying' ||
    stage === 'purified' ||
    stage === 'innerOpen'
  )
}

export type Outcome = 'none' | 'success' | 'locked'

export interface PanelView {
  doors: DoorState
  /** 双门是否同时开启 —— 任意阶段恒为 false，可被测试直接断言 */
  bothDoorsOpen: boolean
  hasItem: boolean
  /** 停止时所在步骤序号（1–8）；done 为 8，锁定时为触发锁定时的步骤 */
  currentStep: number | null
  /** 当前阶段期望执行的操作（面板高亮用）；done/locked 时为 null */
  expectedAction: ActionKind | null
  outcome: Outcome
  isDone: boolean
  isLocked: boolean
}

export function selectView(state: MachineState): PanelView {
  const isDone = state.stage === 'done'
  const isLocked = state.stage === 'locked'
  // 非法操作不得改变物理状态：锁定后舱体投影冻结在触发锁定时的阶段，
  // 仅叠加「锁定」结果。该原始阶段已作为锁定记录的一部分保存。
  const physicalStage = isLocked ? (state.violation?.stage ?? 'idle') : state.stage
  const doors = selectDoors(physicalStage)
  return {
    doors,
    bothDoorsOpen: doors.outerOpen && doors.innerOpen,
    hasItem: selectHasItem(physicalStage),
    currentStep: STAGE_STEP[physicalStage] ?? null,
    expectedAction: LEGAL_TRANSITIONS[state.stage] ?? null,
    outcome: isDone ? 'success' : isLocked ? 'locked' : 'none',
    isDone,
    isLocked,
  }
}

/**
 * 面板上除复位外的八个流程操作（严格按成功路径排序）
 */
export const FLOW_ACTIONS: ActionKind[] = [
  'openOuter',
  'loadItem',
  'closeOuter',
  'startPurification',
  'confirmPurification',
  'openInner',
  'unloadItem',
  'closeInner',
]

// ================= 复盘：用本轮既有动作序列重放，生成只读快照 =================

/**
 * 单个记录点的只读复盘快照。
 *
 * 复盘以「本轮既有的操作记录」为唯一输入：从初始态开始，用同一个
 * `dispatch` 逐条重放记录的动作前缀重新裁决。现场状态与原始记录均不被改写。
 */
export interface ReplaySnapshot {
  /** 该前缀重放裁决后的状态（与当时逐动作得到的投影一致） */
  state: MachineState
  view: PanelView
  /** 该记录点所执行操作的合法性（游标 0 的初始快照为 null） */
  entryOk: boolean | null
  /** 该记录点的期望操作（游标 0 时为第一步 openOuter） */
  expectedAction: ActionKind | null
  /** 是否停在违例记录上（重放已裁决为 locked） */
  atViolation: boolean
}

/**
 * 把游标约束为合法记录点：非有限值 / 负数 / 超出记录总数等一切越界情形
 * 一律回落到 0（初始快照），保证复盘永不因游标异常抛出页面错误。
 */
function clampCursor(cursor: number, max: number): number {
  if (!Number.isFinite(cursor)) return 0
  const n = Math.trunc(cursor)
  if (n < 0 || n > max) return 0
  return n
}

/**
 * 按动作前缀重放：取记录前 `cursor` 条（0 = 初始态，log.length = 终局），
 * 从初始态重新裁决。非法记录会自然在重放中再次锁定，与原状态投影一致。
 *
 * 空记录或任何越界 / 非有限游标都回落到初始快照，不抛出页面错误。
 */
export function replayAt(finalState: MachineState, cursor: number): ReplaySnapshot {
  const at = clampCursor(cursor, finalState.log.length)
  let state: MachineState = { ...INITIAL_STATE, log: [] }
  for (let i = 0; i < at; i++) {
    state = dispatch(state, finalState.log[i].action)
  }
  const entry = at > 0 ? finalState.log[at - 1] : null
  return {
    state,
    view: selectView(state),
    entryOk: entry ? entry.ok : null,
    expectedAction: LEGAL_TRANSITIONS[state.stage] ?? null,
    atViolation: state.stage === 'locked',
  }
}

/** 一轮是否已结束（成功或锁定）：只有结束轮次可进入复盘 */
export function isRoundFinished(state: MachineState): boolean {
  return state.stage === 'done' || state.stage === 'locked'
}
