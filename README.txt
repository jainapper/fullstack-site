Fullstack Fulfillment — Night Freight site (deploy-ready)

To put this online with a public link (about 2 minutes):
1. Go to https://vercel.com/new  (or https://app.netlify.com/drop)
2. Drag the whole 'fullstack-site' folder onto the page
3. You'll get a public URL like fullstack-site.vercel.app
   — later you can attach the real domain (www.fullstackfs.com.au) in the project settings.

Notes:
- Everything is static: index.html + assets. No build step needed.
- The onboarding welcome video uses the AI voiceover files in assets/tts*.mp3.
- To swap in a produced presenter video later, set VIDEO_URL in index.html.
- Personalised onboarding links: https://YOUR-URL/?first_name=Coral#/onboarding
