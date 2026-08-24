import type { NovelWorkshopApi } from './index.ts'

declare global {
  interface Window {
    novelWorkshop: NovelWorkshopApi
  }
}

export {}
