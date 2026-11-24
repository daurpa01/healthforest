import type { Lang } from './format'

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function toCsv(rows: Record<string, unknown>[], lang: Lang): string {
  const sep = lang === 'es' ? ';' : ','
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const lines = [headers.join(sep)]
  for (const row of rows) {
    lines.push(headers.map((header) => cell(row[header], sep)).join(sep))
  }
  return `\uFEFF${lines.join('\n')}`
}

function cell(value: unknown, sep: string): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (text.includes(sep) || text.includes('"') || text.includes('\n')) return `"${text.replaceAll('"', '""')}"`
  return text
}

export async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const box = svg.viewBox.baseVal
  const width = box?.width || svg.clientWidth || 1200
  const height = box?.height || svg.clientHeight || 800
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * scale)
    canvas.height = Math.ceil(height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('png'))), 'image/png'))
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function svgToPdf(svg: SVGSVGElement, title: string): Promise<Blob> {
  const png = await svgToPng(svg, 2)
  const jpeg = await pngBlobToJpeg(png)
  const bytes = pdfBytes(jpeg.bytes, jpeg.width, jpeg.height, title)
  return new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: 'application/pdf' })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image'))
    image.src = url
  })
}

async function pngBlobToJpeg(png: Blob): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(png)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0)
  const url = canvas.toDataURL('image/jpeg', 0.92)
  const binary = atob(url.split(',')[1] ?? '')
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return { bytes, width: canvas.width, height: canvas.height }
}

function pdfBytes(jpeg: Uint8Array, width: number, height: number, title: string): Uint8Array {
  const pageW = 792
  const pageH = Math.max(280, Math.round((pageW * height) / width))
  const content = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im Do\nQ\n`
  const objects: (string | Uint8Array)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /XObject << /Im 5 0 R >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    null as unknown as Uint8Array,
  ]
  const imageDict = `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = [0]
  let size = 0
  const push = (part: Uint8Array) => {
    chunks.push(part)
    size += part.length
  }
  push(encoder.encode(`%PDF-1.4\n%âãÏÓ\n`))
  const body = [objects[0], objects[1], objects[2], objects[3]]
  body.forEach((object, index) => {
    offsets.push(size)
    push(encoder.encode(`${index + 1} 0 obj\n${object}\nendobj\n`))
  })
  offsets.push(size)
  push(encoder.encode(`5 0 obj\n${imageDict}`))
  push(jpeg)
  push(encoder.encode(`\nendstream\nendobj\n`))
  const xref = size
  let xrefTable = `xref\n0 6\n0000000000 65535 f \n`
  for (let i = 1; i <= 5; i++) xrefTable += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  push(encoder.encode(`${xrefTable}trailer\n<< /Size 6 /Root 1 0 R /Info << /Title (${title.replace(/[()\\]/g, '')}) >> >>\nstartxref\n${xref}\n%%EOF`))
  const out = new Uint8Array(size)
  let cursor = 0
  for (const chunk of chunks) {
    out.set(chunk, cursor)
    cursor += chunk.length
  }
  return out
}
