/// <reference types="vite/client" />

declare module '*.trex?raw' {
  const source: string
  export default source
}

declare module '*?worker&inline' {
  const WorkerFactory: new () => Worker
  export default WorkerFactory
}
