/** Error dari API provider git (GitHub/GitLab) dengan pesan yang aman ditampilkan ke pengguna. */
export class GitError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
