import { describe, expect, it } from "vitest";
import { documentProvenance } from "../documentProvenance.ts";

describe("documentProvenance", () => {
  it("nomme l'origine distante et décode l'URL pour la rendre lisible", () => {
    const p = documentProvenance(
      "https://sharedocs.huma-num.fr/dav.php/%40Shares/Corpus%20GRAFE/Asimov_EN_r%C3%A9align%C3%A9.odt",
    );
    expect(p?.origine).toBe("ShareDocs (WebDAV)");
    // En base l'URL est percent-encodée de bout en bout : telle quelle, elle est illisible.
    expect(p?.texte).toBe(
      "https://sharedocs.huma-num.fr/dav.php/@Shares/Corpus GRAFE/Asimov_EN_réaligné.odt",
    );
  });

  it("garde la valeur exacte à côté de la version lisible", () => {
    const brut = "https://dav.example/f/a%20b.docx";
    // L'infobulle sert à copier le chemin : elle ne doit pas porter la version décodée.
    expect(documentProvenance(brut)?.brut).toBe(brut);
  });

  it("distingue un fichier local d'une URL", () => {
    const p = documentProvenance("C:\\Users\\x\\Documents\\corpus\\roman_FR.docx");
    expect(p?.origine).toBe("Fichier local");
    expect(p?.texte).toBe("C:\\Users\\x\\Documents\\corpus\\roman_FR.docx");
  });

  it("ne décode pas un chemin local, qui n'est pas percent-encodé", () => {
    // Un « % » dans un nom de fichier local est un caractère, pas une échappement.
    const p = documentProvenance("/data/100%_final.txt");
    expect(p?.texte).toBe("/data/100%_final.txt");
  });

  it("retombe sur le brut quand l'URL est mal encodée plutôt que de tout perdre", () => {
    // `%zz` fait lever URIError à decodeURIComponent.
    const p = documentProvenance("https://dav.example/f/%zz.docx");
    expect(p?.texte).toBe("https://dav.example/f/%zz.docx");
    expect(p?.origine).toBe("ShareDocs (WebDAV)");
  });

  it("rend null quand il n'y a rien à dire", () => {
    // L'écran n'affiche alors aucune ligne : « provenance inconnue » n'apprendrait rien.
    expect(documentProvenance(null)).toBeNull();
    expect(documentProvenance(undefined)).toBeNull();
    expect(documentProvenance("   ")).toBeNull();
  });
});
