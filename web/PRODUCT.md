# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Decided by the user together with the implementation plan: React + Vite + TypeScript + Tailwind CSS, installable PWA, served by the project's own Node server behind Caddy on a Raspberry Pi 5. No separate design-system library chosen yet.

## Users

One person: the owner, a Spanish-speaking NBA follower. They open the app on an Android phone (installed as a PWA), mostly in short check-ins during the day and after games, to catch up on everything that happened in the NBA. Read-only: they never post, comment or write anything.

## Product Purpose

A private, personal NBA newsroom and scoreboard that replaces the habit of hopping between Twitter/X (news accounts, highlights) and Google (last results, conference standings). One place, ordered and visual, showing: the calendar of all 2026-27 preseason and regular-season games with results, conference standings, news about players and teams, and the best plays of every game played. Success: the owner feels caught up on the whole NBA in a couple of minutes, without opening anything else.

## Positioning

It is built for exactly one fan. Their three favourite teams (Minnesota Timberwolves, Los Angeles Lakers, Philadelphia 76ers) lead everywhere, and sources are the ones this person already trusts (including Spanish-language outlets such as GIGANTESbasket). No ads, no accounts, no engagement mechanics, no other user to serve: a general-purpose NBA app cannot truthfully copy that.

## Operating Context

Phone first, one hand, often with spotty connectivity, so the last loaded content must stay readable offline. Content is mostly English with some Spanish; the interface is Spanish and any English news can be translated to Spanish on demand with one tap. Times are shown in Europe/Madrid, which makes many NBA games late-night or early-morning games for the user. Match results are checked after the fact more often than live. Push notifications announce start and end of favourite-team games.

## Capabilities and Constraints

Screens: Hoy (today), Calendario, Clasificación (East/West), Noticias (filterable by team, player, language), Jugadas (highlight videos, embedded from the official NBA YouTube channel), Partido (game detail), Equipo, Ajustes. Data comes from ESPN's public endpoints, RSS feeds and YouTube RSS; news shows headline, summary, image and a link to the source, never full articles. Videos are embedded, never hosted. Favourites are configured on the server, not editable in the UI in v1. X/Twitter is out of scope for v1.

## Brand Commitments

Name: step-back (the NBA move). The visual identity is undecided and designed from scratch; nothing is reused from the owner's earlier project NBA Insight (explicit instruction).

## Evidence on Hand

No real content yet in the app. Team data, logos and schedules will come from ESPN at build time. Any scores, headlines and dates shown in mockups are synthetic and must be labelled as such.

## Product Principles

1. Caught up in two minutes: the most important things for this fan first, the rest one tap away.
2. Favourites lead: Timberwolves, Lakers and 76ers are always more prominent than the other 27 teams.
3. Read-only and calm: nothing asks the user to act, create, log in or react.
4. Honest about data: always say how fresh it is and when a source is down; never fabricate.
5. Works anywhere: usable one-handed on a phone, offline with the last loaded data.

## Accessibility & Inclusion

Spanish interface. Target WCAG AA contrast and touch targets of at least 44 px; respect reduced-motion. Spoilers: the owner may watch games late; results should be easy to find, and showing a score is the default (a spoiler-hiding option is an open question).
