import express from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildPrompt, publicConfig, saveConfig, streamChat } from './ai.js'
import {
  annotate,
  clearAlerts,
  generateDailyReport,
  getAutomationConfig,
  getReport,
  getStatus,
  getTrend,
  listAlerts,
  listReports,
  markAlertsRead,
  saveAutomationConfig,
  startScheduler,
  takeSnapshot,
} from './automation.js'
import { ROOT } from './paths.js'
import { cancelJob, docPath, getJob, listDocs, startJob } from './docs.js'
import { getHot, hotSources } from './hot.js'
import { search, searchSources } from './search.js'
import { addFavorite, listFavorites, removeFavorite, updateFavorite } from './store.js'
import { closeBrowser } from './browser-publish.js'
import { createPost, getPost, isPlatform, listPosts, removePost, saveUpload, updatePost, uploadPath } from './posts.js'
import { publish } from './publish.js'
import { publicPublishConfig, savePublishConfig } from './publish-config.js'
import { testWechat } from './wechat.js'

const app = express()
// 封面图以 data URL 传上来，放宽请求体大小
app.use(express.json({ limit: '15mb' }))

app.get('/api/sources', (_req, res) => {
  res.json({
    hot: hotSources.map(({ id, name }) => ({ id, name })),
    search: searchSources.map(({ id, name }) => ({ id, name })),
  })
})

app.get('/api/hot/:id', async (req, res) => {
  if (!hotSources.some((s) => s.id === req.params.id)) return res.status(404).end()
  res.json(await annotate(await getHot(req.params.id, req.query.force === '1')))
})

app.get('/api/trend', async (req, res) => {
  const source = String(req.query.source ?? '')
  const title = String(req.query.title ?? '')
  if (!source || !title) return res.status(400).json({ error: '缺少参数' })
  res.json(await getTrend(source, title))
})

app.get('/api/automation', async (_req, res) => {
  res.json({ config: await getAutomationConfig(), status: await getStatus() })
})
app.put('/api/automation', async (req, res) => {
  try {
    res.json({ config: await saveAutomationConfig(req.body ?? {}), status: await getStatus() })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
app.post('/api/automation/snapshot', async (_req, res) => {
  await takeSnapshot()
  res.json(await getStatus())
})

app.get('/api/alerts', async (_req, res) => {
  res.json(await listAlerts())
})
app.post('/api/alerts/read', async (req, res) => {
  await markAlertsRead(Array.isArray(req.body?.ids) ? req.body.ids.map(String) : undefined)
  res.status(204).end()
})
app.delete('/api/alerts', async (_req, res) => {
  await clearAlerts()
  res.status(204).end()
})

app.get('/api/reports', async (_req, res) => {
  res.json(await listReports())
})
app.get('/api/reports/:date', async (req, res) => {
  const md = await getReport(req.params.date)
  if (md === null) return res.status(404).json({ error: '没有这一天的日报' })
  res.json({ date: req.params.date, content: md })
})
app.post('/api/reports', async (_req, res) => {
  try {
    const date = await generateDailyReport()
    res.json({ date, content: await getReport(date) })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.get('/api/search/:id', async (req, res) => {
  if (!searchSources.some((s) => s.id === req.params.id)) return res.status(404).end()
  const q = String(req.query.q ?? '').trim().slice(0, 100)
  if (!q) return res.status(400).json({ error: '缺少关键词' })
  const page = Math.min(50, Math.max(1, Number(req.query.page) || 1))
  res.json(await search(req.params.id, q, page))
})

app.get('/api/favorites', async (_req, res) => {
  res.json(await listFavorites())
})
app.post('/api/favorites', async (req, res) => {
  if (!/^https?:\/\//.test(String(req.body?.url))) return res.status(400).json({ error: '无效链接' })
  res.json(await addFavorite(req.body))
})
app.patch('/api/favorites/:id', async (req, res) => {
  const fav = await updateFavorite(req.params.id, req.body ?? {})
  if (fav) res.json(fav)
  else res.status(404).end()
})
app.delete('/api/favorites/:id', async (req, res) => {
  await removeFavorite(req.params.id)
  res.status(204).end()
})

app.get('/api/ai/config', async (_req, res) => {
  res.json(await publicConfig())
})
app.put('/api/ai/config', async (req, res) => {
  try {
    await saveConfig(req.body ?? {})
    res.json(await publicConfig())
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
app.post('/api/ai/run', async (req, res) => {
  const abort = new AbortController()
  res.on('close', () => abort.abort()) // 前端点「停止」或关闭页面时中断上游请求
  try {
    await streamChat(await buildPrompt(req.body ?? {}), res, abort.signal)
  } catch (e) {
    if (abort.signal.aborted) return
    const msg = (e as Error).message
    if (res.headersSent) res.end(`\n\n> 生成中断：${msg}`)
    else res.status(400).json({ error: msg })
  }
})

app.get('/api/docs', async (_req, res) => {
  res.json({ job: getJob(), files: await listDocs() })
})
app.post('/api/docs', async (req, res) => {
  try {
    res.json(await startJob(req.body ?? {}))
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
app.post('/api/docs/cancel', (_req, res) => {
  cancelJob()
  res.status(204).end()
})
app.get('/api/docs/file/:file', (req, res) => {
  const p = docPath(req.params.file)
  if (!p || !existsSync(p)) return res.status(404).json({ error: '文件不存在' })
  res.download(p, req.params.file)
})

app.get('/api/posts', async (_req, res) => {
  res.json(await listPosts())
})
app.post('/api/posts', async (req, res) => {
  res.json(await createPost(req.body ?? {}))
})
app.patch('/api/posts/:id', async (req, res) => {
  const p = await updatePost(req.params.id, req.body ?? {})
  if (p) res.json(p)
  else res.status(404).json({ error: '文章不存在' })
})
app.delete('/api/posts/:id', async (req, res) => {
  await removePost(req.params.id)
  res.status(204).end()
})
app.post('/api/posts/:id/publish', async (req, res) => {
  try {
    const platforms = Array.isArray(req.body?.platforms) ? req.body.platforms.filter(isPlatform) : []
    await publish(req.params.id, platforms)
    res.json(await getPost(req.params.id))
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})

app.post('/api/uploads', async (req, res) => {
  try {
    res.json({ name: await saveUpload(String(req.body?.dataUrl ?? '')) })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
app.get('/api/uploads/:name', (req, res) => {
  const p = uploadPath(req.params.name)
  if (!p || !existsSync(p)) return res.status(404).end()
  res.sendFile(p)
})

app.get('/api/publish/config', async (_req, res) => {
  res.json(await publicPublishConfig())
})
app.put('/api/publish/config', async (req, res) => {
  try {
    await savePublishConfig(req.body ?? {})
    res.json(await publicPublishConfig())
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
app.post('/api/publish/wechat/test', async (_req, res) => {
  try {
    res.json({ message: await testWechat() })
  } catch (e) {
    res.status(400).json({ error: (e as Error).message })
  }
})
app.post('/api/publish/browser/close', async (_req, res) => {
  await closeBrowser()
  res.status(204).end()
})

// 打包后由后端直接托管前端页面
const dist = path.join(ROOT, 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.use((_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

const port = Number(process.env.API_PORT) || 8787
// Express 5 出错时也会调用回调，并把错误传进来
app.listen(port, '127.0.0.1', (err?: Error) => {
  if (err) {
    console.error(`后端启动失败（端口 ${port} 被占用？）：${err.message}`)
    process.exit(1)
  }
  console.log(`Server running at http://127.0.0.1:${port}`)
  startScheduler()
})
