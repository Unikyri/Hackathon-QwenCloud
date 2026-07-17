export function writePath(universeId: string, chapterId?: string) {
  const base = `/universe/${universeId}/write`
  return chapterId ? `${base}/${chapterId}` : base
}

export function writeImportPath(universeId: string, chapterId?: string) {
  return `${writePath(universeId, chapterId)}?panel=import`
}
