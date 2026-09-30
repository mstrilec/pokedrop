export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return <main className="flex flex-1 items-center justify-center p-8">{children}</main>;
}
