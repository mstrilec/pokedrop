export function PagePlaceholder({ title, ticket }: { title: string; ticket: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>Placeholder. This page is built in {ticket}.</p>
    </section>
  );
}
