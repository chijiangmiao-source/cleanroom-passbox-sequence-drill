<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import {
  ACTION_LABELS,
  FLOW_ACTIONS,
  dispatch,
  INITIAL_STATE,
  isRoundFinished,
  replayAt,
  selectView,
  type ActionKind,
  type MachineState,
} from './fsm'

const state = reactive<MachineState>({ ...INITIAL_STATE, log: [] })

function act(action: ActionKind): void {
  Object.assign(state, dispatch(state, action))
}

const view = computed(() => selectView(state))

// ---- 复盘模式 ---------------------------------------------------------------
// 复盘是覆盖在终局之上的只读视图：live 状态（现场 + 原始记录）始终不被改写。
const replayActive = ref(false)
/** 0 = 初始态；k = 重放前 k 条记录；log.length = 终局 */
const replayCursor = ref(0)

const finished = computed(() => isRoundFinished(state))

const snapshot = computed(() => replayAt(state, replayCursor.value))

function enterReplay(): void {
  if (!finished.value) return
  // 默认停在终局记录点（锁定轮次即违例记录点）
  replayCursor.value = state.log.length
  replayActive.value = true
}

function exitReplay(): void {
  replayActive.value = false
}

/** 复盘中的复位：按现有语义清空本轮，并结束复盘回到空白初态 */
function replayReset(): void {
  Object.assign(state, dispatch(state, 'reset'))
  replayCursor.value = 0
  replayActive.value = false
}

/** 舱体 / 状态条实际展示的状态：复盘时投影自重放快照 */
const displayState = computed<MachineState>(() =>
  replayActive.value ? snapshot.value.state : state,
)
const displayView = computed(() =>
  replayActive.value ? snapshot.value.view : view.value,
)

const buttons = computed(() =>
  FLOW_ACTIONS.map((action) => ({
    action,
    label: ACTION_LABELS[action],
    // 流程进行中八个按钮均可点（允许学员越序，由 FSM 裁决锁定）；
    // 仅在锁定 / 完成后禁用流程按钮。
    disabled: state.stage === 'locked' || state.stage === 'done',
    expected: view.value.expectedAction === action,
  })),
)

const expectedLabel = computed(() =>
  displayView.value.expectedAction === null
    ? null
    : ACTION_LABELS[displayView.value.expectedAction],
)

// ---- 复盘：滑块位置文案 / 步骤条标记 ---------------------------------------

const replayMax = computed(() => state.log.length)

const cursorPositionText = computed(() => {
  const at = Math.min(Math.max(replayCursor.value, 0), replayMax.value)
  if (at === 0) return '初始态（尚无记录）'
  const entry = state.log[at - 1]
  const result = entry.ok ? '合法' : '越序 / 非法'
  return `第 ${at} / ${replayMax.value} 条记录：${ACTION_LABELS[entry.action]}（${result}）`
})

/** 八步成功路径，复盘时在「步骤」区同步标出当前记录 */
const steps = computed(() =>
  FLOW_ACTIONS.map((action, i) => {
    const stepNo = i + 1
    const entry =
      replayCursor.value > 0 ? state.log[replayCursor.value - 1] : null
    const violation = snapshot.value.state.violation
    // 违例点上当前记录由「实际违例」标记承载，避免与更早的同名步骤重复高亮
    const isCurrent =
      entry !== null && !snapshot.value.atViolation && entry.action === action
    // 锁定记录点：标出被违反的期望步骤与实际步骤
    const isExpected =
      snapshot.value.atViolation && violation?.expected === action
    const isActual =
      snapshot.value.atViolation && violation?.actual === action
    const passed = replayCursor.value > 0 && stepNo < replayCursor.value
    return { action, stepNo, isCurrent, isExpected, isActual, passed }
  }),
)
</script>

<template>
  <main class="panel">
    <h1>传递舱双门互锁演练器</h1>

    <!-- 复盘只读提示条 -->
    <section v-if="replayActive" class="replay-banner" data-test="replay-banner">
      <span class="replay-tag">复盘模式 · 只读</span>
      <span class="replay-hint">状态由本轮既有动作序列重新裁决，现场与原始记录不会被改写。</span>
    </section>

    <!-- 舱体与双门：门状态由 FSM 投影（复盘时投影自重放快照） -->
    <section class="chamber" aria-label="舱体状态">
      <div
        class="door outer"
        :class="{ open: displayView.doors.outerOpen }"
        data-test="outer-door"
      >
        <span class="door-name">外门</span>
        <span class="door-state">{{ displayView.doors.outerOpen ? '开启' : '关闭' }}</span>
      </div>

      <div class="chamber-body" data-test="chamber">
        <p class="chamber-title">舱内</p>
        <p class="chamber-item" data-test="chamber-item">
          {{ displayView.hasItem ? '📦 有物品' : '（空）' }}
        </p>
      </div>

      <div
        class="door inner"
        :class="{ open: displayView.doors.innerOpen }"
        data-test="inner-door"
      >
        <span class="door-name">内门</span>
        <span class="door-state">{{ displayView.doors.innerOpen ? '开启' : '关闭' }}</span>
      </div>
    </section>

    <!-- 状态条 -->
    <section class="status-bar" aria-label="当前状态">
      <div class="status-cell">
        <span class="status-label">当前步骤</span>
        <span class="status-value" data-test="current-step">
          <template v-if="displayView.isDone">8 / 8 · 已完成</template>
          <template v-else-if="displayView.isLocked">{{ displayView.currentStep }} / 8 · 已锁定</template>
          <template v-else>{{ displayView.currentStep ?? 1 }} / 8</template>
        </span>
      </div>
      <div class="status-cell">
        <span class="status-label">下一步期望</span>
        <span class="status-value" data-test="expected">
          {{ expectedLabel ?? '—' }}
        </span>
      </div>
    </section>

    <!-- 复盘步骤条：八步成功路径，标出当前记录 / 期望 / 实际 -->
    <section v-if="replayActive" class="steps" aria-label="步骤复盘">
      <ol class="step-list">
        <li
          v-for="s in steps"
          :key="s.action"
          class="step-item"
          :class="{
            current: s.isCurrent,
            expected: s.isExpected,
            actual: s.isActual,
            passed: s.passed && !s.isExpected && !s.isActual,
          }"
          data-test="step-item"
          :data-current="s.isCurrent || s.isActual ? 'true' : 'false'"
        >
          <span class="step-no">{{ s.stepNo }}</span>
          <span class="step-name">{{ ACTION_LABELS[s.action] }}</span>
          <span v-if="s.isExpected" class="step-flag expected-flag">期望</span>
          <span v-if="s.isActual" class="step-flag actual-flag">实际违例</span>
        </li>
      </ol>
      <p
        v-if="snapshot.atViolation && displayState.violation"
        class="replay-violation"
        data-test="replay-violation"
      >
        违例点冻结：期望步骤「{{ ACTION_LABELS[displayState.violation.expected] }}」，
        实际操作「{{ ACTION_LABELS[displayState.violation.actual] }}」；
        舱体投影保持违例前的物理状态。
      </p>
    </section>

    <!-- 结果：持续展示；成功为绿色、锁定为红色（复盘时展示重放裁决结果） -->
    <section
      class="outcome"
      :class="displayView.outcome"
      role="status"
      :data-test="displayView.isDone ? 'result-success' : displayView.isLocked ? 'result-locked' : 'result-none'"
    >
      <template v-if="displayView.isDone">✅ 传递完成</template>
      <template v-else-if="displayView.isLocked">
        <strong>🔒 本轮已锁定</strong>
        <span v-if="displayState.violation" class="violation-detail" data-test="violation">
          期望步骤：{{ ACTION_LABELS[displayState.violation.expected] }}；
          实际操作：{{ ACTION_LABELS[displayState.violation.actual] }}
        </span>
      </template>
      <template v-else>▶ 流程进行中：请按期望步骤操作（越序将立即锁定本轮）</template>
    </section>

    <!-- 复盘控制：进度滑块 + 退出 / 复位 -->
    <section v-if="replayActive" class="replay-controls" aria-label="复盘控制">
      <div class="slider-row">
        <span class="slider-end">初始态</span>
        <input
          v-model.number="replayCursor"
          class="replay-slider"
          type="range"
          min="0"
          :max="replayMax"
          step="1"
          data-test="replay-slider"
        />
        <span class="slider-end">终局（{{ replayMax }} 条记录）</span>
      </div>
      <p class="slider-position" data-test="replay-position">{{ cursorPositionText }}</p>
      <div class="replay-buttons">
        <button class="btn exit-replay-btn" data-test="btn-exit-replay" @click="exitReplay">
          退出复盘
        </button>
        <button class="btn reset-btn" data-test="btn-replay-reset" @click="replayReset">
          复位（清空本轮并退出复盘）
        </button>
      </div>
    </section>

    <!-- 终局面板入口：仅已结束轮次可复盘 -->
    <section v-else-if="finished" class="replay-entry">
      <button class="btn start-replay-btn" data-test="btn-start-replay" @click="enterReplay">
        开始复盘
      </button>
    </section>
    <section v-else class="replay-entry" data-test="replay-entry-disabled">
      <button class="btn start-replay-btn" disabled data-test="btn-start-replay">
        开始复盘
      </button>
      <p class="replay-entry-hint" data-test="replay-hint">
        复盘仅对已结束轮次（成功或锁定）开放，请先完成本轮。
      </p>
    </section>

    <!-- 操作按钮（复盘时隐藏：复盘为只读，操作在复盘控制区） -->
    <section v-if="!replayActive" class="controls" aria-label="操作">
      <button
        v-for="b in buttons"
        :key="b.action"
        class="btn flow-btn"
        :class="{ expected: b.expected }"
        :disabled="b.disabled"
        :data-test="`btn-${b.action}`"
        @click="act(b.action)"
      >
        {{ b.label }}
      </button>
      <button class="btn reset-btn" data-test="btn-reset" @click="act('reset')">
        复位
      </button>
    </section>

    <!-- 本轮操作记录（原始记录；复盘时标出当前记录点，之后的记录置灰） -->
    <section class="log" aria-label="本轮操作记录">
      <h2>本轮操作记录</h2>
      <p v-if="state.log.length === 0" class="log-empty" data-test="log-empty">
        暂无操作，第一步请打开外门。
      </p>
      <table v-else class="log-table" data-test="log-table">
        <thead>
          <tr>
            <th>#</th>
            <th>操作</th>
            <th>结果</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(entry, idx) in state.log"
            :key="entry.seq"
            :class="{
              ok: entry.ok,
              bad: !entry.ok,
              'replay-current': replayActive && idx === replayCursor - 1,
              'replay-ahead': replayActive && idx >= replayCursor,
            }"
            data-test="log-row"
            :data-current="replayActive && idx === replayCursor - 1 ? 'true' : 'false'"
          >
            <td>{{ entry.seq }}</td>
            <td>{{ ACTION_LABELS[entry.action] }}</td>
            <td>{{ entry.ok ? '合法' : '越序 / 非法' }}</td>
            <td>{{ entry.time }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</template>
