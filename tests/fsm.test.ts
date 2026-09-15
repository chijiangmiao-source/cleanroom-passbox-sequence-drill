import { describe, expect, it } from 'vitest'
import {
  ACTION_LABELS,
  dispatch,
  FLOW_ACTIONS,
  INITIAL_STATE,
  selectDoors,
  selectView,
  type ActionKind,
  type MachineState,
} from '../src/fsm'

/** 按唯一成功路径依次执行，返回最终状态 */
function runHappyPath(actions: ActionKind[] = FLOW_ACTIONS): MachineState {
  return actions.reduce<MachineState>(
    (s, a) => dispatch(s, a),
    { ...INITIAL_STATE, log: [] },
  )
}

describe('初始状态', () => {
  it('双门关闭、舱内为空、无进度、无记录', () => {
    const v = selectView(INITIAL_STATE)
    expect(v.doors.outerOpen).toBe(false)
    expect(v.doors.innerOpen).toBe(false)
    expect(v.hasItem).toBe(false)
    expect(v.currentStep).toBe(1)
    expect(v.expectedAction).toBe('openOuter')
    expect(v.outcome).toBe('none')
    expect(INITIAL_STATE.log).toHaveLength(0)
    expect(INITIAL_STATE.violation).toBeNull()
  })
})

describe('全部合法转移（唯一成功路径）', () => {
  const expected: Array<{
    action: ActionKind
    stage: MachineState['stage']
    hasItem: boolean
    outer: boolean
    inner: boolean
    step: number | null
  }> = [
    { action: 'openOuter', stage: 'outerOpen', hasItem: false, outer: true, inner: false, step: 2 },
    { action: 'loadItem', stage: 'loadedOuterOpen', hasItem: true, outer: true, inner: false, step: 3 },
    { action: 'closeOuter', stage: 'outerClosed', hasItem: true, outer: false, inner: false, step: 4 },
    { action: 'startPurification', stage: 'purifying', hasItem: true, outer: false, inner: false, step: 5 },
    { action: 'confirmPurification', stage: 'purified', hasItem: true, outer: false, inner: false, step: 6 },
    { action: 'openInner', stage: 'innerOpen', hasItem: true, outer: false, inner: true, step: 7 },
    { action: 'unloadItem', stage: 'unloadedInnerOpen', hasItem: false, outer: false, inner: true, step: 8 },
    { action: 'closeInner', stage: 'done', hasItem: false, outer: false, inner: false, step: 8 },
  ]

  it('八步逐一推进，门 / 物品 / 步骤均为裁决后状态的投影', () => {
    let state: MachineState = { ...INITIAL_STATE, log: [] }
    for (const [i, e] of expected.entries()) {
      state = dispatch(state, e.action)
      const v = selectView(state)

      expect(state.stage).toBe(e.stage)
      expect(v.doors.outerOpen).toBe(e.outer)
      expect(v.doors.innerOpen).toBe(e.inner)
      expect(v.hasItem).toBe(e.hasItem)
      expect(v.currentStep).toBe(e.step)
      expect(state.stepCount).toBe(i + 1)
      expect(state.log).toHaveLength(i + 1)
      expect(state.log[i]).toMatchObject({ action: e.action, ok: true, seq: i + 1 })
    }
  })

  it('完成后显示「传递完成」', () => {
    const done = runHappyPath()
    const v = selectView(done)
    expect(done.stage).toBe('done')
    expect(v.outcome).toBe('success')
    expect(v.isDone).toBe(true)
  })

  it('每一步面板期望操作恰为路径中的下一步', () => {
    let state: MachineState = { ...INITIAL_STATE, log: [] }
    for (const action of FLOW_ACTIONS) {
      expect(selectView(state).expectedAction).toBe(action)
      state = dispatch(state, action)
    }
    expect(selectView(state).expectedAction).toBeNull()
  })
})

describe('代表性非法操作：越序即锁定', () => {
  const nonResetActions = FLOW_ACTIONS

  it('初始第一步只能打开外门：其余七个操作全部锁定', () => {
    for (const action of nonResetActions.filter((a) => a !== 'openOuter')) {
      const s = dispatch({ ...INITIAL_STATE, log: [] }, action)
      const v = selectView(s)
      expect(s.stage).toBe('locked')
      expect(v.outcome).toBe('locked')
      expect(s.violation).toEqual({
        actual: action,
        expected: 'openOuter',
        stage: 'idle',
      })
    }
  })

  it('净化完成前开启内门 → 锁定，且记录期望步骤与实际操作', () => {
    // 走到「已启动净化」阶段（净化尚未确认完成）
    let s: MachineState = { ...INITIAL_STATE, log: [] }
    for (const a of ['openOuter', 'loadItem', 'closeOuter', 'startPurification'] as ActionKind[]) {
      s = dispatch(s, a)
    }
    expect(s.stage).toBe('purifying')

    s = dispatch(s, 'openInner')
    expect(s.stage).toBe('locked')
    expect(s.violation).toEqual({
      actual: 'openInner',
      expected: 'confirmPurification',
      stage: 'purifying',
    })
    // 锁定时门投影保持关闭
    const v = selectView(s)
    expect(v.doors.innerOpen).toBe(false)
    expect(v.doors.outerOpen).toBe(false)
  })

  it('未取出物品便关闭内门 → 锁定（未取物不得结束流程）', () => {
    let s: MachineState = { ...INITIAL_STATE, log: [] }
    for (const a of [
      'openOuter',
      'loadItem',
      'closeOuter',
      'startPurification',
      'confirmPurification',
      'openInner',
    ] as ActionKind[]) {
      s = dispatch(s, a)
    }
    expect(s.stage).toBe('innerOpen')
    expect(selectView(s).hasItem).toBe(true)

    s = dispatch(s, 'closeInner')
    expect(s.stage).toBe('locked')
    expect(s.violation).toEqual({
      actual: 'closeInner',
      expected: 'unloadItem',
      stage: 'innerOpen',
    })
    // 非法操作不改变物理事实：舱体投影冻结在锁定时的阶段 ——
    // 物品仍在舱内、内门仍投影为开启，仅叠加锁定结果。
    const v = selectView(s)
    expect(v.hasItem).toBe(true)
    expect(v.doors.innerOpen).toBe(true)
    expect(v.doors.outerOpen).toBe(false)
    expect(v.isLocked).toBe(true)
  })

  it('外门打开期间尝试直接启动净化 → 锁定，期望「放入物品」', () => {
    let s = dispatch({ ...INITIAL_STATE, log: [] }, 'openOuter')
    s = dispatch(s, 'startPurification')
    expect(s.stage).toBe('locked')
    expect(s.violation?.expected).toBe('loadItem')
    expect(s.violation?.actual).toBe('startPurification')
  })

  it('完成后再做任何流程操作都判定越序锁定', () => {
    const done = runHappyPath()
    for (const action of nonResetActions) {
      const s = dispatch(done, action)
      expect(s.stage).toBe('locked')
      expect(s.violation?.actual).toBe(action)
      // done 阶段没有下一步，期望记录为复位
      expect(s.violation?.expected).toBe('reset')
    }
  })
})

describe('锁定后：除复位外不得改变状态', () => {
  it('锁定状态下继续操作，状态与物理投影均冻结', () => {
    // 在「内门已开、物品在舱」阶段越序，以验证物理投影冻结
    let s: MachineState = { ...INITIAL_STATE, log: [] }
    for (const a of [
      'openOuter',
      'loadItem',
      'closeOuter',
      'startPurification',
      'confirmPurification',
      'openInner',
      'closeOuter', // 越序：期望「取出物品」
    ] as ActionKind[]) {
      s = dispatch(s, a)
    }
    expect(s.stage).toBe('locked')
    const frozen = structuredClone(s)
    const frozenView = selectView(frozen)

    for (const action of FLOW_ACTIONS) {
      s = dispatch(s, action)
      const v = selectView(s)
      expect(s.stage).toBe('locked')
      expect(s.stepCount).toBe(frozen.stepCount)
      expect(s.log).toHaveLength(frozen.log.length)
      expect(s.violation).toEqual(frozen.violation)
      // 物理投影冻结：内门仍开、物品仍在舱，且双门从不同时开启
      expect(v.doors.innerOpen).toBe(frozenView.doors.innerOpen)
      expect(v.hasItem).toBe(frozenView.hasItem)
      expect(v.bothDoorsOpen).toBe(false)
    }
  })

  it('复位可从锁定中恢复：清空物品 / 进度 / 记录，双门关闭', () => {
    let s = dispatch({ ...INITIAL_STATE, log: [] }, 'startPurification')
    expect(s.stage).toBe('locked')
    s = dispatch(s, 'reset')

    expect(s).toEqual({ ...INITIAL_STATE, log: [] })
    const v = selectView(s)
    expect(v.doors.outerOpen).toBe(false)
    expect(v.doors.innerOpen).toBe(false)
    expect(v.currentStep).toBe(1)
    expect(v.expectedAction).toBe('openOuter')
    expect(v.outcome).toBe('none')
  })

  it('完成后复位，随后第一步只能再次打开外门', () => {
    const s = dispatch(runHappyPath(), 'reset')
    expect(s).toEqual({ ...INITIAL_STATE, log: [] })

    // 复位后重新走成功路径依然成功
    const again = FLOW_ACTIONS.reduce<MachineState>((acc, a) => dispatch(acc, a), s)
    expect(again.stage).toBe('done')
    expect(selectView(again).outcome).toBe('success')
  })

  it('流程中途复位同样清空全部进度', () => {
    let s: MachineState = { ...INITIAL_STATE, log: [] }
    for (const a of ['openOuter', 'loadItem'] as ActionKind[]) s = dispatch(s, a)
    expect(selectView(s).hasItem).toBe(true)
    s = dispatch(s, 'reset')
    expect(s).toEqual({ ...INITIAL_STATE, log: [] })
    expect(selectView(s).hasItem).toBe(false)
  })
})

describe('双门互锁不变量', () => {
  it('全部 10 个阶段中不存在双门同时开启的投影', () => {
    const stages: MachineState['stage'][] = [
      'idle',
      'outerOpen',
      'loadedOuterOpen',
      'outerClosed',
      'purifying',
      'purified',
      'innerOpen',
      'unloadedInnerOpen',
      'done',
      'locked',
    ]
    for (const stage of stages) {
      const d = selectDoors(stage)
      expect(d.outerOpen && d.innerOpen).toBe(false)
    }
  })

  it('完整成功路径全程双门从不同时开启', () => {
    let s: MachineState = { ...INITIAL_STATE, log: [] }
    for (const action of FLOW_ACTIONS) {
      s = dispatch(s, action)
      const v = selectView(s)
      expect(v.bothDoorsOpen).toBe(false)
    }
  })

  it('内门开启期间试图打开外门：判定非法并锁定，外门投影仍关闭', () => {
    let s: MachineState = { ...INITIAL_STATE, log: [] }
    for (const a of [
      'openOuter',
      'loadItem',
      'closeOuter',
      'startPurification',
      'confirmPurification',
      'openInner',
    ] as ActionKind[]) {
      s = dispatch(s, a)
    }
    expect(selectDoors(s.stage).innerOpen).toBe(true)

    s = dispatch(s, 'openOuter')
    expect(s.stage).toBe('locked')
    // 越序操作被裁决拒绝：外门不开启，内门维持开启前的物理事实（投影冻结）
    const v = selectView(s)
    expect(v.doors.outerOpen).toBe(false)
    expect(v.doors.innerOpen).toBe(true)
    expect(v.bothDoorsOpen).toBe(false)
  })

  it('外门开启期间试图打开内门：判定非法并锁定', () => {
    let s = dispatch({ ...INITIAL_STATE, log: [] }, 'openOuter')
    s = dispatch(s, 'openInner')
    expect(s.stage).toBe('locked')
    expect(s.violation).toEqual({
      actual: 'openInner',
      expected: 'loadItem',
      stage: 'outerOpen',
    })
    // 外门维持开启投影，内门不开启 —— 双门仍不同时开启
    const v = selectView(s)
    expect(v.doors.outerOpen).toBe(true)
    expect(v.doors.innerOpen).toBe(false)
    expect(v.bothDoorsOpen).toBe(false)
  })
})

describe('操作记录', () => {
  it('合法与非法操作都按序记录，非法条目标记 ok=false', () => {
    let s: MachineState = { ...INITIAL_STATE, log: [] }
    s = dispatch(s, 'openOuter')
    s = dispatch(s, 'closeOuter') // 越序（未放入物品）
    expect(s.stage).toBe('locked')
    expect(s.log).toHaveLength(2)
    expect(s.log[0]).toMatchObject({ seq: 1, action: 'openOuter', ok: true })
    expect(s.log[1]).toMatchObject({
      seq: 2,
      action: 'closeOuter',
      ok: false,
      stage: 'outerOpen',
    })
  })

  it('文案表覆盖全部九个操作', () => {
    const all: ActionKind[] = [...FLOW_ACTIONS, 'reset']
    for (const a of all) {
      expect(ACTION_LABELS[a]).toBeTruthy()
    }
  })
})
