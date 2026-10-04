import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1>Page not found</h1>
      <Button asChild variant="secondary">
        <Link href="/">Back to PokéDrop</Link>
      </Button>
    </main>
  );
}
