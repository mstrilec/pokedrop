export default function AppLayout({ children }: LayoutProps<'/'>) {
  return <main className="flex-1 p-8">{children}</main>;
}
