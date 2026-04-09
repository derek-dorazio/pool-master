type PlaceholderPageProps = {
  eyebrow: string;
  title: string;
  description: string;
};

export function PlaceholderPage({ eyebrow, title, description }: PlaceholderPageProps) {
  return (
    <section className="rounded-[2rem] border border-border bg-card p-8 shadow-sm">
      <span className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
        {eyebrow}
      </span>
      <div className="mt-4 space-y-3">
        <h2 className="text-3xl font-semibold tracking-tight">{title}</h2>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
      </div>
    </section>
  );
}
