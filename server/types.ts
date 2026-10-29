export interface Item {
  title: string
  url: string
  hot?: string
  /** 热度数值，用于趋势图和飙升判断；有的来源没有 */
  hotValue?: number
  desc?: string
  author?: string
  time?: string
}

export interface SourceResult {
  id: string
  name: string
  items: Item[]
  error?: string
  updatedAt: number
}
