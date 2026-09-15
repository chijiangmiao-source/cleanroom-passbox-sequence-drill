<script setup lang="ts">
import { computed, reactive } from 'vue'
import {
  ACTION_LABELS,
  FLOW_ACTIONS,
  dispatch,
  INITIAL_STATE,
  selectView,
  type ActionKind,
  type MachineState,
} from './fsm'

const state = reactive<MachineState>({ ...INITIAL_STATE, log: [] })

function act(action: ActionKind): void {
  Object.assign(state, dispatch(state, action))
}

const view = computed(() => selectView(state))

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
  view.value.expectedAction === null
    ? null
    : ACTION_LABELS[view.value.expectedAction],
)
</script>

<template>
  <main class="panel">
    <h1>传递舱双门互锁演练器</h1>

    <!-- 舱体与双门：门状态由 FSM 投影 -->
    <section class="chamber" aria-label="舱体状态">
      <div
        class="door outer"
        :class="{ open: view.doors.outerOpen }"
        data-test="outer-door"
      >
        <span class="door-name">外门</span>
        <span class="door-state">{{ view.doors.outerOpen ? '开启' : '关闭' }}</span>
      </div>

      <div class="chamber-body" data-test="chamber">
        <p class="chamber-title">舱内</p>
        <p class="chamber-item" data-test="chamber-item">
          {{ view.hasItem ? '📦 有物品' : '（空）' }}
        </p>
      </div>

      <div
        class="door inner"
        :class="{ open: view.doors.innerOpen }"
        data-test="inner-door"
      >
        <span class="door-name">内门</span>
        <span class="door-state">{{ view.doors.innerOpen ? '开启' : '关闭' }}</span>
      </div>
    </section>

    <!-- 状态条 -->
    <section class="status-bar" aria-label="当前状态">
      <div class="status-cell">
        <span class="status-label">当前步骤</span>
        <span class="status-value" data-test="current-step">
          <template v-if="view.isDone">8 / 8 · 已完成</template>
          <template v-else-if="view.isLocked">{{ view.currentStep }} / 8 · 已锁定</template>
          <template v-else>{{ view.currentStep ?? 1 }} / 8</template>
        </span>
      </div>
      <div class="status-cell">
        <span class="status-label">下一步期望</span>
        <span class="status-value" data-test="expected">
          {{ expectedLabel ?? '—' }}
        </span>
      </div>
    </section>

    <!-- 结果：持续展示；成功为绿色、锁定为红色 -->
    <section
      class="outcome"
      :class="view.outcome"
      role="status"
      :data-test="view.isDone ? 'result-success' : view.isLocked ? 'result-locked' : 'result-none'"
    >
      <template v-if="view.isDone">✅ 传递完成</template>
      <template v-else-if="view.isLocked">
        <strong>🔒 本轮已锁定</strong>
        <span v-if="state.violation" class="violation-detail" data-test="violation">
          期望步骤：{{ ACTION_LABELS[state.violation.expected] }}；
          实际操作：{{ ACTION_LABELS[state.violation.actual] }}
        </span>
      </template>
      <template v-else>▶ 流程进行中：请按期望步骤操作（越序将立即锁定本轮）</template>
    </section>

    <!-- 操作按钮 -->
    <section class="controls" aria-label="操作">
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

    <!-- 本轮操作记录 -->
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
            v-for="entry in state.log"
            :key="entry.seq"
            :class="entry.ok ? 'ok' : 'bad'"
            data-test="log-row"
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
