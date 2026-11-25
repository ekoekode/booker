/** Where the library lives in the vault. One folder, so a copy of it carries everything to another Booker install. */
export const LIBRARY_ROOT = "Booker/Library";
export const LIB_BIBLES = `${LIBRARY_ROOT}/Bibles`;
export const LIB_DATABASES = `${LIBRARY_ROOT}/Databases`;
export const LIB_DOCUMENTS = `${LIBRARY_ROOT}/Documents`;

/** Folders earlier versions used. They are still read; nothing is moved out of them. */
export const LEGACY_BIBLES = "Booker/Bibles";
export const LEGACY_SOURCES = "Sources";

export type LibraryFolder = "Bibles" | "Databases" | "Documents";

export const folderPath = (f: LibraryFolder): string => `${LIBRARY_ROOT}/${f}`;

/** True for anything inside the library, old or new. */
export const inLibrary = (path: string): boolean => path.startsWith(`${LIBRARY_ROOT}/`) || path.startsWith(`${LEGACY_SOURCES}/`) || path.startsWith(`${LEGACY_BIBLES}/`);
