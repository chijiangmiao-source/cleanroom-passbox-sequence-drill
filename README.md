# 传递舱双门互锁演练器

洁净室培训用的**纯前端设备面板演练器**：模拟传递舱（Pass-Through Box）的九种操作，
用一个有限状态机（FSM）裁决唯一成功路径、越序操作与双门互锁，帮助培训验证学员
是否真正遵守纸面 SOP（尤其是「净化完成前不得开内门」「未取物不得结束流程」）。

## 九种操作

| # | 操作 | | # | 操作 |
|---|------|---|---|------|
| 1 | 外门开 | | 6 | 内门开 |
| 2 | 放入物品 | | 7 | 取出物品 |
| 3 | 外门关 | | 8 | 内门关 |
| 4 | 启动净化 | | 9 | 复位 |
| 5 | 确认净化完成 | | | |

唯一成功路径严格按 **1 → 8** 的顺序执行，完成后显示 **✅ 传递完成**。
其余任意顺序的操作均为越序，会**立即锁定本轮**，红色显示期望步骤与实际操作；
锁定后除「复位」外的按钮均不再改变状态。复位清空物品、进度与记录，恢复双门关闭。

## 轮次复盘

一轮结束（成功或锁定）后，终局面板出现 **开始复盘** 入口；流程未结束时入口禁用，
并提示只能复盘已结束轮次。复盘是**只读视图**：

- 用一个进度滑块选择从初始态（游标 0）到任一记录点的动作前缀，FSM 以本轮**既有动作
  序列重新裁决**（`replayAt`），现场状态与原始记录均不被改写。
- 舱体、八步步骤条、操作日志三处**同步标出当前记录**；当前点之后的记录置灰。
- 锁定记录还原**违例前的物理投影**（门 / 物品冻结），并同时展示期望步骤与实际操作。
- **退出复盘**回到原终局；复盘中的**复位**按现有语义清空本轮并结束复盘，回到空白初态。
- 空记录或任何越界 / 非有限游标一律回落到初始快照，不抛出页面错误。

## 设计：单一 FSM 阶段作为唯一真源

- `src/fsm.ts` 是全部流程规则的唯一所在。`MachineState.stage`（10 个阶段）是唯一真源，
  合法转移、越序裁决、双门互锁全部由纯函数 `dispatch(state, action)` 在一处完成。
- 门、舱内物品、当前步骤、期望步骤、成功/锁定结果均为裁决后状态的**纯投影**
  （`selectDoors` / `selectHasItem` / `selectView`），不存在独立的跨步骤约束或门联锁标志。
- **双门互锁是阶段定义的推论**：没有任何阶段投影为双门同时开启（测试对全部阶段及
  完整路径断言 `bothDoorsOpen === false`）。
- 非法操作被裁决拒绝：阶段转为 `locked`，物理投影（门、物品、步骤）冻结在违例发生时
  的阶段，仅叠加锁定结果与违例记录。

```
idle → outerOpen → loadedOuterOpen → outerClosed → purifying
     → purified → innerOpen → unloadedInnerOpen → done
                                                         （任一阶段越序 → locked）
```

## 技术栈

TypeScript · Vue 3（Composition API）· Vite · Vitest · Playwright · Docker（nginx 静态托管）

## 本地开发

```bash
npm ci
npm run dev          # 开发服务器
npm run typecheck    # 类型检查
npm run test:unit    # Vitest 单元测试（FSM 全部合法/非法转移与互锁不变量）
npm run build        # 产出 dist/
npm run test:e2e     # Playwright（自动启动 vite preview）
```

## Docker Compose

```bash
# 启动静态 Web 应用（默认宿主端口 8080）
docker compose up -d --build
# 打开 http://localhost:8080

# 覆盖宿主端口
WEB_PORT=9000 docker compose up -d --build

# 一次性验收服务：类型检查 + 单测 + 构建 + 针对 web 容器的端到端测试，退出即结束
docker compose run --rm verify
```

- `web`：多阶段构建（Node 构建 → nginx 托管 `dist/`），端口 `"${WEB_PORT:-8080}:80"`。
- `verify`：一次性服务，依赖 `web` 健康检查通过后，通过 `E2E_BASE_URL=http://web:80`
  对容器内站点跑完整验收，适合作为 CI / 交付验收入口。
