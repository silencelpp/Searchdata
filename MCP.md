# 接入 MCP（Claude / Cursor / VS Code / Codex / Kiro 等）

选题雷达自带一个 MCP 服务。接入后，可以在支持 MCP 的 AI 工具里直接用自然语言查热榜、搜索、管理素材库，例如：

- 「看看今天微博和抖音热搜，挑 3 个适合科技号的选题存进素材库，标签打上 待写」
- 「搜一下最近公众号上关于 AI 就业的文章，帮我总结主流观点」
- 「把素材库里标签是 待写 的选题列出来，给每个写一个小红书标题」

MCP 服务和网页版共用 `data/favorites.json`，在 AI 工具里收藏的素材，刷新网页后就能看到。MCP 服务不需要网页版在运行。

## 提供的工具

| 工具 | 作用 |
| --- | --- |
| `get_hot_list` | 获取热榜：weibo、zhihu、douyin、bilibili、baidu、toutiao，或 all |
| `search` | 关键词搜索：web（Bing）、wechat（公众号）、bilibili，或 all |
| `list_favorites` | 查看素材库，可按标签或关键词筛选 |
| `add_favorite` | 收藏选题，可带笔记和标签 |
| `update_favorite` | 修改素材的笔记或标签 |
| `remove_favorite` | 删除素材 |

## 启动命令

所有工具里填的都是同一条命令（stdio 方式）：

- 命令：`node`
- 参数：`D:/workSpace/workspace/Searchdata/node_modules/tsx/dist/cli.mjs` 和 `D:/workSpace/workspace/Searchdata/server/mcp.ts`

如果以后把项目移到别的目录，记得把这两个路径一起改掉。

## Codex CLI

```bash
codex mcp add searchdata -- node D:/workSpace/workspace/Searchdata/node_modules/tsx/dist/cli.mjs D:/workSpace/workspace/Searchdata/server/mcp.ts
```

## Claude Code

```bash
claude mcp add searchdata --scope user -- node D:/workSpace/workspace/Searchdata/node_modules/tsx/dist/cli.mjs D:/workSpace/workspace/Searchdata/server/mcp.ts
```

## Claude Desktop、Cursor、Kiro、Antigravity 等（JSON 配置）

这几个工具的配置格式相同，把下面这段合并进对应的配置文件：

```json
{
  "mcpServers": {
    "searchdata": {
      "command": "node",
      "args": [
        "D:/workSpace/workspace/Searchdata/node_modules/tsx/dist/cli.mjs",
        "D:/workSpace/workspace/Searchdata/server/mcp.ts"
      ]
    }
  }
}
```

配置文件位置：

- Claude Desktop：设置 → 开发者 → 编辑配置（`%APPDATA%\Claude\claude_desktop_config.json`）
- Cursor：`%USERPROFILE%\.cursor\mcp.json`，或设置 → MCP
- Kiro：`%USERPROFILE%\.kiro\settings\mcp.json`
- 其他工具：在它的 MCP 设置里找 `mcpServers` 配置

保存后重启该工具，或在它的 MCP 面板里刷新。

## VS Code（Copilot）

VS Code 用的键名是 `servers`，不是 `mcpServers`。在 `.vscode/mcp.json` 或用户配置的 MCP 设置里填：

```json
{
  "servers": {
    "searchdata": {
      "type": "stdio",
      "command": "node",
      "args": [
        "D:/workSpace/workspace/Searchdata/node_modules/tsx/dist/cli.mjs",
        "D:/workSpace/workspace/Searchdata/server/mcp.ts"
      ]
    }
  }
}
```

## 自己测试

用官方的 MCP Inspector 可以在浏览器里逐个调用工具：

```bash
npx @modelcontextprotocol/inspector node D:/workSpace/workspace/Searchdata/node_modules/tsx/dist/cli.mjs D:/workSpace/workspace/Searchdata/server/mcp.ts
```
