import type {
  ThemeLibraryDocument,
  ThemeLibrarySnapshot,
  ThemeProfileV2,
  ThemeSelection,
  ThemeWindowInheritance
} from '../../shared/theme.ts'
export declare class ThemeLibraryRepository {
  constructor(filePath: string, initialDocument: () => ThemeLibraryDocument)
  load(): Promise<ThemeLibrarySnapshot>
  saveProfile(
    candidate: ThemeProfileV2,
    expectedRevision: number,
    now?: string
  ): Promise<ThemeLibrarySnapshot>
  deleteProfile(profileId: string, expectedRevision: number): Promise<ThemeLibrarySnapshot>
  setActive(selection: ThemeSelection, expectedRevision: number): Promise<ThemeLibrarySnapshot>
  setWindowInheritance(
    inheritance: ThemeWindowInheritance,
    expectedRevision: number
  ): Promise<ThemeLibrarySnapshot>
  replaceDocument(
    candidate: ThemeLibraryDocument,
    expectedRevision: number
  ): Promise<ThemeLibrarySnapshot>
}
