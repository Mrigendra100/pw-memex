---
test: TC01 - Search results are displayed for a query
suite: tests/googleSearch.spec.ts
baseline: '2026-04-05T12:40:40.728Z'
baseUrl: 'http://localhost:3000'
status: passed
---
## Route journey
/

## Steps


## Selector anchors


## Network calls


## Screenshots
- step-0 (step-0): `eae53e5637d784bb`
- step-1 (step-1): `90631f5fc35cfb73`
- step-2 (step-2): `534e36919bfdf6c2`
- step-3 (step-3): `364e4603bfaa4c55`
- step-4 (step-4): `8bb0b335b7e06b8c`
- step-5 (step-5): `a797ce574fb60786`
- step-6 (step-6): `1bf8560c27aa3ef0`
- step-7 (step-7): `e6abf0fd7fa95a79`
- step-8 (step-8): `5ed7e555bdae8535`
- step-9 (step-9): `1e96abd005efee9f`
- step-10 (step-10): `3d0f5f6a9892abdb`
- step-11 (step-11): `aa0620ab4eb9ca91`
- step-12 (step-12): `69b39232a3f136b7`
- step-13 (step-13): `b6b9131be6ef3a63`
- step-14 (step-14): `f6c776877418f5fa`
- step-15 (step-15): `043c6ef4bb979c65`
- step-16 (step-16): `f4a7a3ba0c3e4415`
- step-17 (step-17): `25792783fb6ac986`
- step-18 (step-18): `4edf2a7a03df1b48`
- step-19 (step-19): `1aa5e7d0bc65d693`
- step-20 (step-20): `8046d6790d2d63d1`
- step-21 (step-21): `202a9a02aadbe181`
- step-22 (step-22): `160bf38e6b3d0ab0`
- step-23 (step-23): `c73ba01916aa44b1`
- step-24 (step-24): `63fc1e96b0798a84`
- step-25 (step-25): `bbdf41da896b4b22`
- step-26 (step-26): `d49ae6742d649e28`
- step-27 (step-27): `b1b0301ff4a59361`
- step-28 (step-28): `9ddcfb4962e4247b`
- step-29 (step-29): `e3508c7960665d2b`
- step-30 (step-30): `d67b3ec7d8ecee98`
- step-31 (step-31): `5ad3d5ae80928897`
- step-32 (step-32): `2e342cadba6e8927`
- step-33 (step-33): `6a746941848b3136`
- step-34 (step-34): `b120ea3dce4dcf44`
- step-35 (step-35): `ba6343d9e78f8daf`
- step-36 (step-36): `eb7e686e488ed882`
- step-37 (step-37): `58a6634e7fb28052`
- step-38 (step-38): `45812df15f753341`
- step-39 (step-39): `c666cb75f6e8c4f8`
- step-40 (step-40): `5f44e69e81147bd2`
- step-41 (step-41): `12775bdcdef3cf32`
- step-42 (step-42): `2b352baa03891201`
- step-43 (step-43): `c77ec37bc8be5b37`
- step-44 (step-44): `4773d9da27176faf`
- step-45 (step-45): `56da9b87789e5eb1`
- step-46 (step-46): `da439e146e95ccd9`
- step-47 (step-47): `dbb96418791ee6ea`
- step-48 (step-48): `ce9a435c3f2c7d24`
- step-49 (step-49): `23061050ae661a3d`
- step-50 (step-50): `a3cb0711999fa96d`
- step-51 (step-51): `f388a10c42fbb5d8`
- step-52 (step-52): `c75713176201e4f7`
- step-53 (step-53): `a81e91ba70a8f9fb`
- step-54 (step-54): `de71aa895234be3f`
- step-55 (step-55): `3c8c353f8ce60ac4`
- step-56 (step-56): `de71aa895234be3f`
- step-57 (step-57): `3a829f9747ec49e0`
- step-58 (step-58): `3a829f9747ec49e0`
- step-59 (step-59): `dadfdbfcc78910b6`
- step-60 (step-60): `536886c7b8f7eec4`
- step-61 (step-61): `9c9f6fe8ad5f62d7`
- step-62 (step-62): `71bc8cc574dd1b5e`
- step-63 (step-63): `0a39f37775fc911a`
- step-64 (step-64): `2c39bcfb18867996`
- step-65 (step-65): `4e13f1d542c059f7`
- step-66 (step-66): `0b060219987951db`
- step-67 (step-67): `95739e648f8b33b4`
- step-68 (step-68): `48d1a8e84c87345d`
- step-69 (step-69): `48d1a8e84c87345d`
- step-70 (step-70): `48d1a8e84c87345d`
- step-71 (step-71): `48d1a8e84c87345d`
- step-72 (step-72): `48d1a8e84c87345d`
- step-73 (step-73): `666352e7717d20c3`
- step-74 (step-74): `53e8709595af5167`

## AI summary
This test verifies that the search functionality returns and displays results when a user submits a search query. The test likely navigates to a search page, enters a search term, submits the query, and confirms that result elements appear on the page. Since no specific low-stability selectors are flagged and no network calls are documented, a failure most likely means either the search results container failed to render, the search submission mechanism broke (such as a button handler or form action), or there's a backend issue preventing results from being returned. If this test fails, first verify the search API is responding correctly, then check if recent UI changes affected the search results display logic or the query submission flow.
