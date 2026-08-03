/**
 * Crédito do desenvolvedor fixo na viewport.
 * Fica discreto no canto inferior direito para não competir com o conteúdo,
 * e abaixo da navbar/modais no empilhamento (z-40).
 */
const DeveloperCredit = () => (
  <a
    href="https://djonatanvargas.com.br/bio"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="Sistema desenvolvido por Djonatan Vargas"
    className="fixed bottom-3 right-3 z-40 group flex items-center gap-1.5
               rounded-full border border-border/60 bg-background/70 backdrop-blur-md
               px-3 py-1.5 shadow-lg
               text-[10px] sm:text-[11px] leading-none
               transition-colors hover:border-primary/60 hover:bg-background/90"
  >
    <span className="hidden sm:inline text-muted-foreground">Sistema desenvolvido por</span>
    <span className="sm:hidden text-muted-foreground">por</span>
    <span className="font-semibold text-primary group-hover:underline">Djonatan Vargas</span>
  </a>
);

export default DeveloperCredit;
