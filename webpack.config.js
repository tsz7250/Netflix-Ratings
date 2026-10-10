const webpack = require('webpack');
const path = require('path');

require('dotenv').config({ path: './.env' });

module.exports = {
    mode: "production",
    entry: {
        extension: './src/index.ts',
        background: './src/background.ts',
        popup: './src/popup.ts',
        options: './src/options.ts',
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            }
        ]
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    output: {
        path: path.resolve(__dirname, 'build'),
        filename: '[name].js',
    },
    plugins: [
        new webpack.DefinePlugin({
            "OMDB_HOST": JSON.stringify(process.env["OMDB_HOST"] || "https://www.omdbapi.com"),
        })
    ]
};