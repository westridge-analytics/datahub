# Getting set up with the 990 Research App

This guide is for someone who is going to use and change the 990 research tool with
Claude Code, and who does not write software. You will not need to understand any of the
code. You will need to click through a few account invitations, install two apps, and then
paste one long message to Claude, which does the rest.

Budget about 30 minutes, most of it waiting for downloads.

---

## What this thing is

A private web app that holds IRS Form 990 data — two million nonprofit organizations and
8.3 million annual filings, fiscal years 1976 to 2026 — with search, comparison, charts and CSV export on top of
it. It lives at **https://datahub-lovat.vercel.app** and requires a login.

Three pieces sit behind it, and you will hear all three named:

- **GitHub** — where the app's code is kept. You will need a free account there if you
  do not have one; sign up at https://github.com first and send Joel your username.
- **Vercel** — the service that runs the live website.
- **Neon** — the database where the 990 data actually sits.

You do not have to learn any of them. You need an account on the first two so that Claude,
running on your computer, is allowed to touch them on your behalf.

---

## Step 1 — Ask for access

Send this to Joel (analytics@westridge.finance). Nothing below works until all three arrive.

> Could you set me up on the 990 app?
> 1. Add me as a collaborator with write access on the **westridge-analytics/datahub**
>    GitHub repository.
> 2. Add me to the **westridge** team on Vercel.
> 3. Create me a login for the app itself — that's a separate account from the other two.
>
> My email for all three: *(yours)*

Accept the GitHub and Vercel invitations from your email when they arrive. Keep the app
login somewhere safe; you will type it into the site later.

---

## Step 2 — Install two things

**Claude Code.** Download the Claude desktop app from https://claude.ai/download, sign in,
and open the **Code** tab. That is where you will be working.

**Node.** Go to https://nodejs.org and download the installer marked **LTS**. Run it and
accept the defaults. This is the engine the app runs on; you will never interact with it
directly.

If you are on a Mac and have never used the Terminal, you may also be prompted once to
install Apple's developer command line tools. Say yes and let it finish.

---

## Step 3 — Make a folder and open it in Claude

Create an empty folder — `Documents/westridge` is fine. In the Claude desktop app's Code
tab, start a new session and choose that folder as the project directory.

---

## Step 4 — Paste this to Claude

Copy everything in the box and send it as your first message. Claude will work through it
and stop to ask you things — a browser window for signing in to GitHub, another for Vercel.
Answer those and it will carry on.

```
I'm not an engineer. Please set up the Westridge 990 research app on this machine for me,
explaining each step in plain language and telling me clearly whenever you need me to click
something. Don't assume I know the jargon.

Here is what needs to happen:

1. Check that git, git-lfs, Node 24+, and Python 3.11+ are installed. Install whatever is
   missing using whatever package manager this machine has, or give me a download link and
   wait. git-lfs matters — the repository stores multi-gigabyte data files through it, and
   cloning without it produces broken placeholder files.

2. Get me authenticated to GitHub. Use the GitHub CLI (`gh auth login`) with the browser
   flow rather than SSH keys, and walk me through it.

3. Clone https://github.com/westridge-analytics/datahub.git into this folder. The data files
   are large, so clone with GIT_LFS_SKIP_SMUDGE=1 and only fetch specific data files later
   if we actually need them.

4. Read CLAUDE.md at the root of the repository before doing anything else. It is the real
   architecture document for this project and it describes conventions that differ from what
   you would otherwise assume.

5. Install the app's dependencies (npm install inside apps/web).

6. Set up Vercel: install the CLI if needed, run `vercel login` and walk me through the
   browser step, then `vercel link` (team: westridge, project: datahub), then
   `vercel env pull apps/web/.env.local`. That file holds the database credentials — never
   copy it anywhere, never paste its contents into a chat, and never commit it.
   Afterwards check whether AUTH_SECRET is in that file; if it isn't, generate one.

7. Set up the Python side: a virtual environment plus
   `pip install -r scripts/requirements.txt`. This is only needed for loading new IRS data,
   but set it up now so it's ready.

8. Create .claude/launch.json in the repository root with a "dev" configuration that runs
   `npm run dev` in apps/web on port 3000, so you can start and preview the app yourself.

9. Start the app and confirm it loads at http://localhost:3000. Then run the test suite
   (`npm test` from apps/web, with the dev server running) and tell me plainly whether
   everything passed.

Important, and please hold to it for the rest of our work together: there is only one
database, and it is the live production one. There is no practice copy. Reading from it is
completely safe. Before anything that writes, changes or deletes data, stop and explain to
me in plain language what will change and how many rows, and wait for me to say yes.
```

---

## Step 5 — Check it worked

When Claude says it is finished, you should be able to do these three things:

1. Open http://localhost:3000 in your browser and see a login page. Sign in with the app
   account from Step 1 and a large table of nonprofit filings should appear.
2. Open https://datahub-lovat.vercel.app and see the same thing. That is the live site that
   everyone else uses; it keeps running whether or not your computer is on.
3. Claude reports that the tests passed. If some failed, that is worth mentioning to Joel
   before you change anything — it usually means a credential did not come through.

To start the app again on another day, just open the folder in Claude Code and ask it to
start the dev server.

---

## How to work with it from here

Talk to Claude in plain English about what you want. It reads the code, makes the change,
and tests it. Useful things to say:

- *"Show me what this app can currently do"* — good first question; it will read the project
  notes and summarize.
- *"Add a filter for X"* / *"The export is missing Y"* — normal requests. Ask it to run the
  tests before it tells you it is done.
- *"Put this on the live site"* — it will push the change, and Vercel republishes the site
  within a couple of minutes. Ask it to make a pull request first if you want Joel to look
  before it goes live.
- *"Load the latest IRS data"* — possible, but slow (hours) and it writes to the real
  database. Coordinate with Joel first.

### The one real hazard

Everything shares a single live database. Your local copy of the app is not a sandbox — it
is a window onto the same data the live site uses. Reading and searching cannot hurt
anything. Loading data, deleting data, or running what Claude calls a "migration" can, and
some of it is not reversible.

So: if Claude proposes anything that writes to the database, ask it two questions —
*"what exactly changes, in plain terms?"* and *"can this be undone?"* — and loop in Joel if
the answer to the second is no. Claude has been told to stop and ask, but the instruction is
only as good as the session it was given in, and a fresh conversation will not remember it.

### Things that are not your fault

- **It asks for permission constantly at first.** Normal. It is asking before running
  commands on your machine.
- **Something breaks after an update.** Paste the error back to Claude and say *"this
  happened, please fix it, and explain what went wrong in plain language."* That is a
  legitimate and usually sufficient response.
- **The whole setup gets into a state nobody can explain.** Delete the folder and redo
  Steps 3 and 4. Nothing is lost — the code lives on GitHub and the data lives in the
  database, neither of which is on your computer.

---

## The short version

1. Get invited to GitHub and Vercel, and get an app login.
2. Install the Claude desktop app and Node.
3. Make a folder, open it in Claude Code.
4. Paste the block in Step 4.
5. Answer the sign-in prompts.
6. Open http://localhost:3000.
