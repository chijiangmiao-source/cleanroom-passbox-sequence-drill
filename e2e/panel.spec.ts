import { expect, test } from '@playwright/test'

const FLOW = [
  ['btn-openOuter', '外门开'],
  ['btn-loadItem', '放入物品'],
  ['btn-closeOuter', '外门关'],
  ['btn-startPurification', '启动净化'],
  ['btn-confirmPurification', '确认净化完成'],
  ['btn-openInner', '内门开'],
  ['btn-unloadItem', '取出物品'],
  ['btn-closeInner', '内门关'],
] as const

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test.describe('初始面板', () => {
  test('双门关闭、舱内为空，八个流程按钮均可操作', async ({ page }) => {
    await expect(page.getByTestId('outer-door')).toContainText('关闭')
    await expect(page.getByTestId('inner-door')).toContainText('关闭')
    await expect(page.getByTestId('chamber-item')).toHaveText('（空）')
    await expect(page.getByTestId('current-step')).toHaveText('1 / 8')
    await expect(page.getByTestId('expected')).toHaveText('外门开')

    // 演练器允许学员按下任意操作，合法性由 FSM 裁决
    for (const [id] of FLOW) {
      await expect(page.getByTestId(id)).toBeEnabled()
    }
  })

  test('第一步执行非「外门开」操作立即锁定（第一步只能打开外门）', async ({
    page,
  }) => {
    await page.getByTestId('btn-openInner').click()
    await expect(page.getByTestId('result-locked')).toBeVisible()
    await expect(page.getByTestId('violation')).toContainText('期望步骤：外门开')
    await expect(page.getByTestId('violation')).toContainText('实际操作：内门开')
  })
})

test.describe('完整成功流程', () => {
  test('严格按序执行八项操作后显示传递完成', async ({ page }) => {
    const outerDoor = page.getByTestId('outer-door')
    const innerDoor = page.getByTestId('inner-door')
    const chamber = page.getByTestId('chamber-item')

    // 1 外门开：外门开启、内门保持关闭
    await page.getByTestId('btn-openOuter').click()
    await expect(outerDoor).toContainText('开启')
    await expect(innerDoor).toContainText('关闭')
    await expect(page.getByTestId('current-step')).toHaveText('2 / 8')

    // 2 放入物品
    await page.getByTestId('btn-loadItem').click()
    await expect(chamber).toContainText('有物品')
    // 双门互锁：外门开时内门始终关闭
    await expect(innerDoor).toContainText('关闭')

    // 3 外门关
    await page.getByTestId('btn-closeOuter').click()
    await expect(outerDoor).toContainText('关闭')
    await expect(chamber).toContainText('有物品')

    // 4 启动净化
    await page.getByTestId('btn-startPurification').click()
    await expect(page.getByTestId('current-step')).toHaveText('5 / 8')

    // 5 确认净化完成
    await page.getByTestId('btn-confirmPurification').click()
    await expect(page.getByTestId('current-step')).toHaveText('6 / 8')

    // 6 内门开：内门开启、外门保持关闭（互锁）
    await page.getByTestId('btn-openInner').click()
    await expect(innerDoor).toContainText('开启')
    await expect(outerDoor).toContainText('关闭')

    // 7 取出物品
    await page.getByTestId('btn-unloadItem').click()
    await expect(chamber).toHaveText('（空）')
    await expect(innerDoor).toContainText('开启')

    // 8 内门关
    await page.getByTestId('btn-closeInner').click()
    await expect(innerDoor).toContainText('关闭')
    await expect(outerDoor).toContainText('关闭')

    // 成功结果
    await expect(page.getByTestId('result-success')).toBeVisible()
    await expect(page.getByTestId('result-success')).toContainText('传递完成')

    // 八条记录全部合法
    await expect(page.getByTestId('log-row')).toHaveCount(8)
    await expect(page.getByTestId('log-table').getByText('越序 / 非法')).toHaveCount(0)

    // 完成后流程按钮全部禁用，仅复位可用
    for (const [id] of FLOW) {
      await expect(page.getByTestId(id)).toBeDisabled()
    }
    await expect(page.getByTestId('btn-reset')).toBeEnabled()
  })
})

test.describe('违例锁定与复位', () => {
  test('净化完成前开启内门：立即红色锁定并记录期望/实际，复位后恢复', async ({
    page,
  }) => {
    // 走到「净化中」：外门开 → 放入 → 外门关 → 启动净化
    await page.getByTestId('btn-openOuter').click()
    await page.getByTestId('btn-loadItem').click()
    await page.getByTestId('btn-closeOuter').click()
    await page.getByTestId('btn-startPurification').click()

    // 越序：净化未确认完成就开内门（演练器允许按下，由 FSM 裁决）
    await page.getByTestId('btn-openInner').click()

    // 红色锁定结果，记录期望步骤与实际操作
    const locked = page.getByTestId('result-locked')
    await expect(locked).toBeVisible()
    await expect(locked).toContainText('本轮已锁定')
    const violation = page.getByTestId('violation')
    await expect(violation).toContainText('期望步骤：确认净化完成')
    await expect(violation).toContainText('实际操作：内门开')

    // 除复位外按钮全部禁用
    for (const [id] of FLOW) {
      await expect(page.getByTestId(id)).toBeDisabled()
    }

    // 锁定后点击流程按钮不改变状态：记录条数保持 5（dispatch 对锁定状态短路）
    const rowsBefore = await page.getByTestId('log-row').count()
    await page.getByTestId('btn-openOuter').click({ force: true })
    await expect(page.getByTestId('log-row')).toHaveCount(rowsBefore)
    await expect(locked).toBeVisible()

    // 复位：清空物品、进度、记录，双门关闭
    await page.getByTestId('btn-reset').click()
    await expect(page.getByTestId('result-locked')).toHaveCount(0)
    await expect(outerDoorOf(page)).toContainText('关闭')
    await expect(innerDoorOf(page)).toContainText('关闭')
    await expect(page.getByTestId('chamber-item')).toHaveText('（空）')
    await expect(page.getByTestId('current-step')).toHaveText('1 / 8')
    await expect(page.getByTestId('log-empty')).toBeVisible()

    // 复位后第一步只能再次打开外门：面板指示期望步骤，且按序点击可重新走通完整流程
    await expect(page.getByTestId('expected')).toHaveText('外门开')
    for (const [id] of FLOW) {
      await page.getByTestId(id).click()
    }
    await expect(page.getByTestId('result-success')).toContainText('传递完成')
  })

  test('未取物便结束（内门开时直接关内门）：锁定', async ({ page }) => {
    for (const [id] of FLOW.slice(0, 6)) {
      await page.getByTestId(id).click()
    }
    // 当前内门开启、物品在舱；越序关内门（跳过取出物品）
    await page.getByTestId('btn-closeInner').click()

    await expect(page.getByTestId('result-locked')).toBeVisible()
    await expect(page.getByTestId('violation')).toContainText('期望步骤：取出物品')
    await expect(page.getByTestId('violation')).toContainText('实际操作：内门关')
  })
})

function outerDoorOf(page: import('@playwright/test').Page) {
  return page.getByTestId('outer-door')
}
function innerDoorOf(page: import('@playwright/test').Page) {
  return page.getByTestId('inner-door')
}
