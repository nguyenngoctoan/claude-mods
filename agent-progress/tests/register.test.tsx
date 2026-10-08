import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'agent-progress'
const PROGRESS = 'mcp__agent-progress__progress'
const PANE_ID = 'savvy-agents'
const SURFACES = ['terminal', 'desktop'] as const

const AGENTS_INFO = {
  command: 'agents-info',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 200 },
} as const

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
} as const

const PANE = {
  component: 'Pane',
  requestId: PANE_ID,
  props: { title: 'Agents', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

// The engine beneath the plugin: a spawn resolves a model and an id named
// after its description, turns and Agent calls complete, panes open and
// close, settings are empty, and a band the plugin leaves alone draws the
// engine's own line.
function engine(on: On, models: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: 1_000 })
  const panes = new Set<string>()
  const opened: string[] = []
  const closed: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__${PLUGIN}__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('settings.read', () => ({ value: {} }))
  on('agent.spawn', ($, e) => ({ model: models[e.description] ?? 'claude-opus-5-5', agentId: `agent-${e.description}` }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('tool.call', { tool: 'Agent' }, () => ({ result: { status: 'completed' } as never }))
  on('ui.open', ($, e) => {
    panes.add(e.id)
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    panes.delete(e.id)
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({ value: [...panes].map(id => ({ id, title: 'Agents', isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine band</Text>
  })
  return { opened, closed, clock }
}

let spawned = 0
const spawn = ($: Engine, description: string, subagentType = 'Explore') =>
  $.agent.spawn({
    tool_use_id: `toolu_${++spawned}`,
    provider: { plugin: 'test', tier: 'core' },
    description,
    prompt: 'do it',
    subagentType,
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })

const svgAlts = async (ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({ type: 'Svg' })).map(svg => String(svg.props.alt))

test('a reported plan draws the progress row above the prompt on each surface', async ($, on) => {
  engine(on)
  const reported = await $.tool.call({ tool: PROGRESS, title: 'Port the mod', total: 4, done: 1, phase: 'delegate' })
  expect(reported.result).toBe('ok: Tasks 1/4')

  const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await terminal.find({ text: 'Port the mod' })).toBeDefined()
  expect(await terminal.find({ text: '██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░' })).toBeDefined()
  expect(await terminal.find({ text: 'Tasks 1/4' })).toBeDefined()
  expect(await terminal.find({ text: '25%' })).toBeDefined()
  expect(await terminal.find({ key: 'savvy-agents' })).toMatchObject({ props: { label: '×0' } })
  expect(await terminal.find({ key: 'savvy-dismiss' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...BAND })
  expect(await svgAlts(desktop)).toEqual(['Port the mod: Tasks 1/4, 25%'])
  expect(await desktop.find({ key: 'savvy-agents' })).toBeDefined()
  await desktop.unmount()
})

test('a new title starts a fresh flow and finished reads Done', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'First', total: 3, done: 2, phase: 'delegate' })
  expect((await $.tool.call({ tool: PROGRESS, title: 'Second', total: 2 })).result).toBe('ok: Plan')
  expect((await $.tool.call({ tool: PROGRESS, phase: 'design' })).result).toBe('ok: Design')
  expect((await $.tool.call({ tool: PROGRESS, phase: 'review', done: 1 })).result).toBe('ok: Review 1/2')
  expect((await $.tool.call({ tool: PROGRESS, done: 2, finished: true })).result).toBe('ok: Done')
})

test('dismissing the band clears the flow', async ($, on) => {
  engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'Port the mod', total: 2, phase: 'delegate' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ text: 'engine band' })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  await ui.press({ key: 'savvy-dismiss' })
  await ui.redraw()
  expect(await ui.find({ text: 'engine band' })).toBeDefined()
  await ui.unmount()
})

test('the band is the engine own until a flow is reported or a savvy worker starts', async ($, on) => {
  engine(on)
  await spawn($, 'scan models')
  await $.tool.call({ tool: 'Agent', subagent_type: 'Explore', description: 'scan models', prompt: 'p' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    expect(await ui.find({ text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }

  await $.tool.call({ tool: 'Agent', subagent_type: 'savvy-light', description: 'fix lint', prompt: 'p' })
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect(await ui.find({ text: 'savvy-flow' })).toBeDefined()
  expect(await ui.find({ text: 'Tasks 0 running' })).toBeDefined()
  await ui.unmount()
})

test('a subagent moves from running to finished in the panel, with tokens and cost', async ($, on) => {
  engine(on)
  await spawn($, 'scan models')

  const terminal = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await terminal.find({ text: 'Running · 1' })).toBeDefined()
  expect(await terminal.find({ text: 'scan models' })).toBeDefined()
  expect(await terminal.find({ text: /Explore · Opus 5\.5/ })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await svgAlts(desktop)).toContain('scan models: Opus 5.5, running')
  await desktop.unmount()

  await $.turn.complete({
    agentId: 'agent-scan models',
    reason: 'answer',
    answer: 'found 3',
    durationMs: 5_000,
    isAborted: false,
    turnId: 't1',
    usage: { model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  })

  const done = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await done.find({ key: 'done' })).toMatchObject({ props: { label: '▾ Finished · 1' } })
  expect(await done.find({ text: /Running/ })).toBeUndefined()
  expect(await done.find({ text: /≈\$4\.00 · 1\.0M tokens/ })).toBeDefined()
  await done.unmount()

  const desktopDone = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await svgAlts(desktopDone)).toContain('scan models: Opus 5.5, finished')
  await desktopDone.unmount()
})

test('/agents-info opens the panel and closes it again', async ($, on) => {
  engine(on)
  expect((await $.command.run(AGENTS_INFO)).text).toBe('Agents panel opened.')
  expect((await $.command.run(AGENTS_INFO)).text).toBe('Agents panel closed.')
})

test('the panel opens by itself once per flow, for the first subagent and never for planned tasks', async ($, on) => {
  const { opened } = engine(on)
  const tasks = [{ title: 'write tests', tier: 'light' }]
  await $.tool.call({ tool: PROGRESS, title: 'Port the mod', tasks })
  await $.tool.call({ tool: PROGRESS, tasks })
  expect(opened).toEqual([])

  await spawn($, 'scan models', 'Explore')
  expect(opened).toEqual([PANE_ID])
  await spawn($, 'write tests', 'savvy-light')
  expect(opened).toEqual([PANE_ID])

  await $.tool.call({ tool: PROGRESS, title: 'Next flow', tasks })
  await spawn($, 'write module', 'savvy-careful')
  expect(opened).toEqual([PANE_ID, PANE_ID])
})

test('the panel closes once no subagent is left, and opens again for the next one', async ($, on) => {
  const { opened, closed } = engine(on)
  await $.tool.call({ tool: PROGRESS, title: 'First plan', total: 1 })
  await spawn($, 'scan models')
  expect(opened).toEqual([PANE_ID])
  await finish($, 'agent-scan models', usage('claude-opus-5-5', 1_000))

  await $.tool.call({ tool: PROGRESS, title: 'Second plan', total: 1 })
  expect(closed).toEqual([PANE_ID])

  await spawn($, 'next job')
  expect(opened).toEqual([PANE_ID, PANE_ID])
})

test('a panel opened by hand stays open when a plan starts with no subagents', async ($, on) => {
  const { closed } = engine(on)
  await $.command.run(AGENTS_INFO)
  await $.tool.call({ tool: PROGRESS, title: 'First plan', total: 1 })
  await $.tool.call({ tool: PROGRESS, title: 'Second plan', total: 1 })
  expect(closed).toEqual([])
})

test('Collapse folds the panel to its icons and Expand brings the rows back', async ($, on) => {
  engine(on)
  await spawn($, 'scan models')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const toggle = async () => String((await ui.find({ key: 'compact' }))?.props.label)
  expect(await toggle()).toBe('Collapse')
  expect((await ui.find({ type: 'Text', text: /Running/ }))?.text).toBe('Running · 1')

  await ui.press({ key: 'compact' })
  await ui.redraw()
  expect(await toggle()).toBe('Expand')
  expect(await ui.find({ type: 'Text', text: /Running/ })).toBeUndefined()

  await ui.press({ key: 'compact' })
  await ui.redraw()
  expect((await ui.find({ type: 'Text', text: /Running/ }))?.text).toBe('Running · 1')
  await ui.unmount()
})

test('planned tasks show until a run with the same description starts', async ($, on) => {
  engine(on)
  await $.tool.call({
    tool: PROGRESS,
    title: 'Port the mod',
    phase: 'delegate',
    tasks: [
      { title: 'write tests', tier: 'light' },
      { title: 'write module', tier: 'careful', after: [1] },
    ],
  })

  let ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ text: 'Planned · 2' })).toBeDefined()
  await ui.unmount()

  await spawn($, 'Write tests', 'savvy-light')
  ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ text: 'Planned · 1' })).toBeDefined()
  expect(await ui.find({ text: /2\. write module/ })).toBeDefined()
  expect(await ui.find({ text: /careful · Opus · high · after 1/ })).toBeDefined()
  await ui.unmount()

  const desktop = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', ...PANE })
  expect(await svgAlts(desktop)).toContain('2. write module: planned')
  await desktop.unmount()
})

test('the language option draws the panel in Russian', { options: { language: 'ru' } }, async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await spawn($, 'scan models')
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ text: 'Работают · 1' })).toBeDefined()
  await ui.unmount()
})

test('auto follows the system locale when settings name no language', async ($, on) => {
  engine(on)
  mock.env(on, { LANG: 'ru_RU.UTF-8' })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  expect((await $.command.run(AGENTS_INFO)).text).toBe('Панель агентов открыта.')
})

const usage = (model: string, input: number, output = 0, cacheRead = 0) => ({
  model,
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: 0,
})

// One model request of a subagent; the test's turn.step hook answers its usage.
async function step($: Engine, agentId: string, model: string) {
  const s = $.turn.step({ turnId: `turn-${agentId}`, index: 0, model, messageCount: 1, agentId })
  for await (const _ of s) void _
  return s.result
}

const finish = ($: Engine, agentId: string, u: ReturnType<typeof usage>) =>
  $.turn.complete({ agentId, reason: 'answer', answer: 'ok', durationMs: 1, isAborted: false, turnId: `turn-${agentId}`, usage: u })

test('Haiku 5.5 is priced at its own rates, with the higher tier past 100K prompt tokens, against a 1M window', async ($, on) => {
  engine(on, { small: 'claude-haiku-5-5', large: 'claude-haiku-5-5' })
  const answers = new Map<string, ReturnType<typeof usage>>()
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: answers.get(e.agentId ?? '') ?? null }
  })
  await spawn($, 'small')
  await spawn($, 'large')
  answers.set('agent-small', usage('claude-haiku-5-5', 100_000, 100_000))
  answers.set('agent-large', usage('claude-haiku-5-5', 200_000))
  await step($, 'agent-small', 'claude-haiku-5-5')
  await step($, 'agent-large', 'claude-haiku-5-5')

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  expect(await ui.find({ text: /ctx 20% · 200k ≈\$0\.06 / })).toBeDefined()
  expect(await ui.find({ text: /ctx 20% · 200k ≈\$0\.10 / })).toBeDefined()
  await ui.unmount()
})

test('Sonnet 4.6 and Fable 5 cost their own rates, apart from Sonnet 5.5 and Fable 5.1', async ($, on) => {
  engine(on, { s46: 'claude-sonnet-4-6', s55: 'claude-sonnet-5-5', f5: 'claude-fable-5', f51: 'claude-fable-5-1' })
  for (const d of ['s46', 's55', 'f5', 'f51']) await spawn($, d)
  await finish($, 'agent-s46', usage('claude-sonnet-4-6', 1_000_000))
  await finish($, 'agent-s55', usage('claude-sonnet-5-5', 1_000_000))
  await finish($, 'agent-f5', usage('claude-fable-5', 0, 0, 1_000_000))
  await finish($, 'agent-f51', usage('claude-fable-5-1', 0, 0, 1_000_000))

  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...PANE })
  const rows = (await ui.findAll({ type: 'Text', text: /≈\$/ })).map(t => t.text)
  expect(rows.some(r => r.includes('≈$3.00'))).toBe(true)
  expect(rows.some(r => r.includes('≈$2.00'))).toBe(true)
  expect(rows.some(r => r.includes('≈$1.00'))).toBe(true)
  expect(rows.some(r => r.includes('≈$0.25'))).toBe(true)
  await ui.unmount()
})

// The model requests the engine beneath answers, in order: the usage each one
// reports and how long it took on the mocked clock.
function requests(on: On, clock: { advance: (ms: number) => Promise<void> }, plan: [ReturnType<typeof usage>, number][]) {
  on('turn.step', async function* ($, e) {
    const [u, ms] = plan.shift() ?? [null, 0]
    await clock.advance(ms)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: u }
  })
}

// One model request, of the main session or, with an agentId, of a subagent.
async function request($: Engine, agentId?: string) {
  const s = $.turn.step({ turnId: `turn-${agentId ?? 'main'}`, index: 0, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of s) void _
}

test('the bar shows the tokens used by the session and subagents, and the latest tokens per second', async ($, on) => {
  const { clock } = engine(on)
  requests(on, clock, [
    [usage('claude-opus-5-5', 4_000, 200), 2_000],
    [usage('claude-opus-5-5', 800), 500],
  ])
  await $.tool.call({ tool: PROGRESS, title: 'Port the mod', total: 4, done: 1, phase: 'delegate' })
  await spawn($, 'scan models')

  await request($)
  const first = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await first.find({ type: 'Text', text: /tok/ }))?.text).toBe('4k tok · 100 tps')
  await first.unmount()

  await request($, 'agent-scan models')
  for (const surface of SURFACES) {
    const band = await $.ui.mount({ plugin: PLUGIN, surface, ...BAND })
    if (surface === 'terminal') expect((await band.find({ type: 'Text', text: /tok/ }))?.text).toBe('5k tok · 100 tps')
    else expect(await svgAlts(band)).toEqual(['Port the mod: Tasks 1/4, 25%, 5k tok · 100 tps'])
    await band.unmount()
  }
})

test('a new flow starts the token count over', async ($, on) => {
  const { clock } = engine(on)
  requests(on, clock, [
    [usage('claude-opus-5-5', 4_000, 200), 2_000],
    [usage('claude-opus-5-5', 1_000), 500],
  ])
  await $.tool.call({ tool: PROGRESS, title: 'First plan', total: 2, done: 0, phase: 'delegate' })
  await request($)
  const before = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await before.find({ type: 'Text', text: /tok/ }))?.text).toBe('4k tok · 100 tps')
  await before.unmount()

  await $.tool.call({ tool: PROGRESS, title: 'Second plan', total: 2, done: 0, phase: 'delegate' })
  await request($)
  const after = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await after.find({ type: 'Text', text: /tok/ }))?.text).toBe('1k tok · 100 tps')
  await after.unmount()
})

test('the bar shows the cache hit: prompt tokens read from the cache over all prompt tokens, started over by a new flow', async ($, on) => {
  const { clock } = engine(on)
  requests(on, clock, [
    [usage('claude-opus-5-5', 1_000, 200, 3_000), 2_000],
    [usage('claude-opus-5-5', 1_000, 0, 7_000), 500],
    [usage('claude-opus-5-5', 1_000, 200), 2_000],
  ])
  const text = async () => {
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
    const found = (await band.find({ type: 'Text', text: /tok/ }))?.text
    await band.unmount()
    return found
  }
  await $.tool.call({ tool: PROGRESS, title: 'Cached plan', total: 2, done: 0, phase: 'delegate' })

  await request($)
  expect(await text()).toBe('4k tok · 75% cache · 100 tps')
  await request($)
  expect(await text()).toBe('12k tok · 83% cache · 100 tps')

  await $.tool.call({ tool: PROGRESS, title: 'Cold plan', total: 2, done: 0, phase: 'delegate' })
  await request($)
  expect(await text()).toBe('1k tok · 100 tps')
})

// The band's first line of text on the terminal: the flow's title, or the engine's own band.
async function shown($: Engine) {
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  const found = (await band.find({ type: 'Text', text: /engine band|Short plan|Open plan|savvy-flow/ }))?.text
  await band.unmount()
  return found
}

test('a finished flow keeps the tokens it used: later requests are not counted', async ($, on) => {
  const { clock } = engine(on)
  requests(on, clock, [
    [usage('claude-opus-5-5', 4_000, 200), 2_000],
    [usage('claude-opus-5-5', 5_000), 500],
  ])
  await $.tool.call({ tool: PROGRESS, title: 'Short plan', total: 1, done: 0, phase: 'delegate' })
  await request($)
  await $.tool.call({ tool: PROGRESS, done: 1, finished: true })
  await request($)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await band.find({ type: 'Text', text: /tok/ }))?.text).toBe('4k tok · 100 tps')
  await band.unmount()
})

test("the person's next prompt clears a finished bar, and an open plan or a notification leaves it", async ($, on) => {
  engine(on)
  const submit = (kind: 'composer' | 'task-notification') => $.prompt.submit({ text: 'next', wait: false, origin: { kind } })
  await $.tool.call({ tool: PROGRESS, title: 'Open plan', total: 2, done: 0, phase: 'delegate' })

  await submit('composer')
  expect(await shown($)).toBe('Open plan')

  await $.tool.call({ tool: PROGRESS, done: 2, finished: true })
  await submit('task-notification')
  expect(await shown($)).toBe('Open plan')

  await submit('composer')
  expect(await shown($)).toBe('engine band')
})

test('a savvy worker launched after a finished flow starts the token count over', async ($, on) => {
  const { clock } = engine(on)
  requests(on, clock, [
    [usage('claude-opus-5-5', 4_000, 200), 2_000],
    [usage('claude-opus-5-5', 1_000), 500],
  ])
  await $.tool.call({ tool: PROGRESS, title: 'Short plan', total: 1, done: 0, phase: 'delegate' })
  await request($)
  await $.tool.call({ tool: PROGRESS, done: 1, finished: true })
  await $.tool.call({ tool: 'Agent', subagent_type: 'savvy-light', description: 'fix lint', prompt: 'p' })
  await request($)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', ...BAND })
  expect((await band.find({ type: 'Text', text: /tok/ }))?.text).toBe('1k tok · 100 tps')
  await band.unmount()
})
