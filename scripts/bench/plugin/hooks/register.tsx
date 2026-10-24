import type { Register } from 'claude-code'

type Item = { i: number; model: string; system: string; known: string; task: string }

/** `/bench <dir>`: runs every item of `<dir>/in.json` through `$.model.complete` as listening does, 16 at a time, into `<dir>/out.json`. */
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'bench', description: 'Great Question bench: detect calls through the engine' })
    return next(e)
  })
  on('command.run', { command: 'bench' }, async ($, e) => {
    const dir = e.args.trim()
    const items = JSON.parse((await $.fs.read(`${dir}/in.json`)) as string) as Item[]
    const run = async (it: Item) => {
      const t0 = Date.now()
      const r = await $.model.complete({ model: it.model, effort: 'low', system: it.system, prompt: [{ text: it.known, cache: true }, { text: it.task }], maxTokens: 1200, timeoutMs: 60_000 })
      return { i: it.i, model: it.model, ms: Date.now() - t0, out: r.usage?.output_tokens ?? 0, text: r.isAnswered ? r.text : '' }
    }
    // Blocks, so one call's time is not the queue of all.
    const out = []
    for (let k = 0; k < items.length; k += 16) out.push(...(await Promise.all(items.slice(k, k + 16).map(run))))
    await $.fs.write(`${dir}/out.json`, JSON.stringify(out))
    return { text: `bench: ${out.length} calls` }
  })
}
