/*
Discord Extreme List - Discord's unbiased list.

Copyright (C) 2020 Cairo Mitchell-Acason, John Burke, Advaith Jagathesan

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

const express = require("express");
const session = require("express-session");
const path = require("path");

const settings = require("./settings.json");

const app = express();

dbReady = false;

app.set("views", path.join(__dirname, "src/Assets/Views"));
app.use(express.static(path.join(__dirname, "src/Assets/Public")));

app.get("*", (req, res, next) => {
    if (
        dbReady === false &&
        !req.url.includes(".css") &&
        !req.url.includes(".woff2")
    ) {
        return res
            .status(503)
            .sendFile(path.join(__dirname + "/src/Assets/Public/loading.html"));
    } else next();
});

console.time("Mongo TTL");
console.log("Mongo: Connection opening...");
const { MongoClient } = require("mongodb");
let db;
new Promise((resolve, reject) => {
    MongoClient.connect(
        settings.db.mongo,
        { useUnifiedTopology: true, useNewUrlParser: true }, // useNewUrlParser is set to true because sometimes MongoDB is a cunt - Ice, I love this comment - Cairo
        (error, mongo) => {
            if (error) return reject(error);
            db = mongo.db("del");
            console.log("Mongo: Connection established! Released deadlock as a part of startup...");
            console.timeEnd("Mongo TTL");
            resolve();
        }
    );
})
    .then(async () => {
        dbReady = true;
        app.db = db;
        const botCache = require("./src/Util/Services/botCaching.js");
        const serverCache = require("./src/Util/Services/serverCaching.js");
        const userCache = require("./src/Util/Services/userCaching.js");
        const featuredCache = require("./src/Util/Services/featuring.js");
        const templateCache = require("./src/Util/Services/templateCaching.js");
        global.redis = new (require("ioredis"))(settings.db.redis);

        console.time("Redis Cache");
        await userCache.uploadUsers();
        await templateCache.uploadTemplates();
        await featuredCache.updateFeaturedBots();
        await featuredCache.updateFeaturedServers();
        console.timeEnd("Redis Cache");

        const createError = require("http-errors");
        const cookieParser = require("cookie-parser");
        const logger = require("morgan");
        const device = require("express-device");
        const compression = require("compression");
        const i18n = require("i18n");
        const passport = require("passport");

        app.set("view engine", "ejs");

        app.use(
            logger(
                ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer"',
                {
                    skip: (r) => r.url === "/profile/game/snakes",
                }
            )
        );
        app.use(express.json());
        app.use(express.urlencoded({ extended: false }));
        app.use(cookieParser());
        app.use(compression());

        app.use(device.capture());

        i18n.configure({
            locales: ["en-NZ"],
            directory: __dirname + "/src/Assets/Locale",
            defaultLocale: "en-NZ",
            cookie: "lang",
        });

        app.use(
            session({
                secret: settings.website.secrets.cookie,
                name: "delSession",
                resave: false,
                saveUninitialized: true,
                cookie: {
                    secure: false,
                    maxAge: 604800000,
                },
            })
        );

        app.use(passport.initialize());
        app.use(passport.session());

        app.use((req, res, next) => {
            res.locals.user = req.user;
            next();
        });

        app.use(i18n.init);

        app.use("/", require("./src/Routes/index.js"));
        app.use("/search", require("./src/Routes/search.js"));
        app.use("/", require("./src/Routes/authentication.js"));
        app.use("/bots", require("./src/Routes/bots.js"));
        app.use("/servers", require("./src/Routes/servers.js"));
        app.use("/users", require("./src/Routes/users.js"));
        app.use("/staff", require("./src/Routes/staff.js"));
        app.use("/amp", require("./src/Routes/amp.js"));

        app.use("*", require("./src/Util/Function/variables.js"));

        app.use((req, res, next) => {
            next(createError(404));
        });

        app.use((err, req, res, next) => {
            res.locals.message = err.message;
            res.locals.error = req.app.get("env") === "development" ? err : {};

            if (err.message === "Not Found")
                return res.status(404).render("status", {
                    title: res.__("Error"),
                    subtitle: "This page does not exist.",
                    status: 404,
                    type: "Error",
                    req: req,
                    pageType: {
                        home: false,
                        standard: true,
                        server: false,
                        bot: false,
                    },
                });

            res.status(err.status || 500);
            res.render("error");
        });
    })
    .catch((e) => {
        console.error("Mongo error: ", e);
        process.exit(1);
    });

module.exports = app;
