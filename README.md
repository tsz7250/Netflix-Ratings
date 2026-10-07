# Netflix Ratings

## About
Displays IMDb, Rotten Tomatoes, and Metacritic ratings directly on Netflix interface.

Ratings are sourced from:
- [IMDb (Internet Movie Database)](https://www.imdb.com/)
- [Rotten Tomatoes (Tomatometer & Popcornmeter)](https://www.rottentomatoes.com/)
- [Metacritic](https://www.metacritic.com/)


![Screenshot](assets/screenshot.gif)

## Build

Two environment variables are required before running the build script:

- OMDB_HOST="https://www.omdbapi.com"
- OMDB_API_KEY=<secret-key>

You can set them using the `export` command or by creating the `.env` in the root directory.

```
> npm run build
```

## Installation
### Development
If you want to install it locally, you need to update the [Open Movie Database](http://www.omdbapi.com/) in the source code. First, you need to request one [here](http://www.omdbapi.com/apikey.aspx). Once you have it, edit the `scripts/api.js` file at line 43.

```js
const query = new OpenMovieDatabaseQuery("<secret-key>", title, year);
```

Browse to `chrome://extensions/`, activate the developer mode and click the *Load unpacked* button. Select the project root directory in the file explorer. The extension should be loaded succesfully.

You can start working.