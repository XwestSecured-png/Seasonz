import Link from "next/link";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const errorMessage: Record<string, string> = {
    code: "That invite code isn't right. Ask a Seasonz admin for a current code.",
    platform: "That invite code is for a different device type. Ask an admin for the code for your phone or computer.",
    taken: "That username is already taken — pick another one.",
    mismatch: "Those passwords don't match.",
    short: "Pick a username and password that are each at least 3 characters.",
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-neutral-800 bg-neutral-950/70 backdrop-blur-sm p-6 shadow-2xl">
        <h1 className="text-xl font-semibold text-neutral-100 mb-1">
          Create your account
        </h1>
        <p className="text-sm text-neutral-400 mb-6">
          Seasonz is invite-only. Enter the invite code an admin gave you, then
          pick your own username and password.
        </p>
        <form action="/api/signup" method="POST" className="space-y-3">
          <input
            type="text"
            name="inviteCode"
            placeholder="Invite code (e.g. IOS-ABCD-2345)"
            autoCapitalize="characters"
            autoCorrect="off"
            autoFocus
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <input
            type="text"
            name="username"
            placeholder="Choose a username"
            autoComplete="username"
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <input
            type="password"
            name="password"
            placeholder="Choose a password"
            autoComplete="new-password"
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <input
            type="password"
            name="confirmPassword"
            placeholder="Confirm password"
            autoComplete="new-password"
            className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          {error && (
            <p className="text-sm text-red-400">
              {errorMessage[error] ?? "Something went wrong — try again."}
            </p>
          )}
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 hover:bg-blue-500 transition-colors px-3 py-2 text-white font-medium"
          >
            Create account
          </button>
        </form>
        <p className="text-sm text-neutral-500 mt-4 text-center">
          Already have an account?{" "}
          <Link prefetch={false} href="/login" className="text-blue-400 hover:text-blue-300">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
