/**
 * Cloud-sync path detection (R-01 garde environnementale P3).
 *
 * Ouvrir une base SQLite dans un dossier synchronisé (OneDrive, Dropbox, …) est la
 * cause environnementale de l'incident R-01 : le client de sync verrouille le fichier
 * et peut figer le sidecar (recovery WAL bloquée). On ne *bloque* pas (l'utilisateur
 * peut sciemment vouloir une base cloud), on **avertit** simplement à l'ouverture.
 *
 * Détection par composant de chemin (heuristique pure, sans accès OS/env) : on cherche
 * un segment de dossier connu, borné par des séparateurs `/` ou `\` (Windows + POSIX).
 */

export interface CloudSyncResult {
  /** true si le chemin est sous un dossier de synchronisation cloud connu. */
  synced: boolean;
  /** nom du fournisseur détecté (`null` si non synchronisé). */
  provider: string | null;
}

// Chaque motif matche un *segment de dossier* (entre séparateurs), pas une sous-chaîne
// de nom de fichier — évite les faux positifs type "MonOneDriveBackup".
const CLOUD_PROVIDERS: ReadonlyArray<{ provider: string; re: RegExp }> = [
  // OneDrive, OneDrive - Personal, OneDrive - Company, OneDrive-Personal (macOS CloudStorage)
  { provider: "OneDrive", re: /[/\\]OneDrive([ _-][^/\\]*)?[/\\]/i },
  { provider: "Dropbox", re: /[/\\]Dropbox([ _-][^/\\]*)?[/\\]/i },
  { provider: "Google Drive", re: /[/\\]Google ?Drive([ _-][^/\\]*)?[/\\]/i },
  // macOS iCloud Drive (deux emplacements possibles)
  { provider: "iCloud Drive", re: /[/\\](iCloud ?Drive|Mobile Documents[/\\]com~apple~CloudDocs)[/\\]/i },
  // macOS : tous les fournisseurs récents passent par ~/Library/CloudStorage/<Provider>-<compte>/
  { provider: "cloud (CloudStorage)", re: /[/\\]Library[/\\]CloudStorage[/\\]/i },
];

/**
 * Indique si `path` se trouve sous un dossier de synchronisation cloud connu.
 * Renvoie `{ synced: false, provider: null }` pour un chemin local ou vide.
 */
export function isCloudSyncedPath(path: string | null | undefined): CloudSyncResult {
  if (!path) return { synced: false, provider: null };
  for (const { provider, re } of CLOUD_PROVIDERS) {
    if (re.test(path)) return { synced: true, provider };
  }
  return { synced: false, provider: null };
}
