import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 项目根目录。MCP 服务可能从任意工作目录启动，所以不能用 process.cwd() */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = process.env.SEARCHDATA_DATA_DIR
  ? path.resolve(process.env.SEARCHDATA_DATA_DIR)
  : path.join(ROOT, 'data')
