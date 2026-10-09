import { SeasonzLogo } from "../seasonz-logo";
import Link from "next/link";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-950/70 backdrop-blur-sm p-6 shadow-2xl">
        <h1 className="mb-2">
          <SeasonzLogo size="lg" />
        </h1>
        <p className="text-sm text-neutral-400 mb-6">
          Private — log in with your username and password.
        </p>
        <form action="/api/login" method="POST" className="space-y-3">
          <input type="hidden" name="next" value={next ?? "/"} />
          <input
            type="text"
            name="username"
            placeholder="Username"
            autoFocus
            autoComplete="username"
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          {error && (
            <p className="text-sm text-red-400">
              Wrong username or password — try again.
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 hover:bg-blue-500 transition-colors px-3 py-2 text-white font-medium"
          >
            Log in
          </button>
        </form>
        <p className="text-sm text-neutral-500 mt-4 text-center">
          New here?{" "}
          <Link href="/signup" className="text-blue-400 hover:text-blue-300">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
