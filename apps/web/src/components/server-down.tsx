export function ServerDown({ detail }: { detail?: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-3 px-5 py-10">
      <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Lights</h1>
      <p className="text-[#c9c3b8] leading-6">
        Couldn’t reach the configure server. The list is not loaded, so nothing
        here is claimed as a Light.
      </p>
      {detail ? (
        <p className="font-mono text-xs text-quiet">{detail}</p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        From the repo root, run <span className="font-mono text-foreground">pnpm dev</span> so
        the API on 43181 is up with the web app.
      </p>
    </div>
  );
}
