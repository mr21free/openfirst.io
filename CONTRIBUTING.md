# Contributing to OpenFirst

Thanks for considering a contribution. A few things before you open a PR.

## License

OpenFirst (the app: builder + reader) is licensed under [AGPL-3.0](./LICENSE).
By contributing, you agree your contribution is licensed under the same
terms.

## Developer Certificate of Origin (DCO)

Every commit must be signed off. This certifies you wrote the contribution
(or otherwise have the right to submit it under the project's license) —
it's a lightweight alternative to a CLA, used by the Linux kernel and many
other open-source projects. See [developercertificate.org](https://developercertificate.org/)
for the full text.

Add a `Signed-off-by` line to every commit, either with:

```
git commit -s -m "your message"
```

or by hand:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use your real name and a real, reachable email — anonymous or pseudonymous
sign-offs won't be accepted. PRs with unsigned commits will be asked to
amend before merge.

By signing off, you certify:

> Developer Certificate of Origin 1.1
>
> By making a contribution to this project, I certify that:
>
> (a) The contribution was created in whole or in part by me and I have the
> right to submit it under the open source license indicated in the file; or
>
> (b) The contribution is based upon previous work that, to the best of my
> knowledge, is covered under an appropriate open source license and I have
> the right under that license to submit that work with modifications,
> whether created in whole or in part by me, under the same open source
> license (unless I am permitted to submit under a different license), as
> indicated in the file; or
>
> (c) The contribution was provided directly to me by some other person who
> certified (a), (b) or (c) and I have not modified it.
>
> (d) I understand and agree that this project and the contribution are
> public and that a record of the contribution (including all personal
> information I submit with it, including my sign-off) is maintained
> indefinitely and may be redistributed consistent with this project or the
> open source license(s) involved.

## Note on future dual-licensing

A DCO certifies that your contribution is properly licensed under the AGPL —
it does not by itself grant OpenFirst the right to relicense your
contribution under different (e.g. commercial) terms. If OpenFirst moves to
a dual AGPL/commercial licensing model in the future, contributors whose
code is affected will be asked to separately agree to a CLA covering that;
nothing here commits you to that in advance.

## Opening a PR

- Keep changes focused — one concern per PR is easier to review.
- Run the test suite (`npm test` in `app/`) before opening.
- Explain the *why*, not just the *what*, in your PR description.
