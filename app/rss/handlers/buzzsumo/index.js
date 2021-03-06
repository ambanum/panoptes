const request = require('request-promise');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const dbs = {};

function init(dbFileName) {
    const dbPath = path.join(__dirname, '..', '..', 'db', `${dbFileName}.json`);
    const adapter = new FileSync(dbPath);
    const db = low(adapter);
    // Set some defaults (required if your JSON file is empty)
    db.defaults({ posts: [] }).write();

    dbs[dbFileName] = db;
}

async function handler(feedName, item, { message }, mattermostConfig) {
    const db = dbs[feedName];
    const itemInDb = db.get('posts')
        // Posts are uniquely identified by their link URL
        .find({ link: item.link })
        .value();

    // if the post is already in db, it has already been sent to mattermost, so nothing to do…
    if (itemInDb) {
        return;
    }

    // Remove everything after the first HTML tag
    const sanitizedDescription = item.description.substring(0, item.description.indexOf('<'));
    const shares = item["buzzsumo:shares"];
    const totalShares = shares["buzzsumo:total"]['#'];
    const messageContent = `
${sanitizedDescription}

**Total engagement: ${totalShares}**
Facebook: ${shares["buzzsumo:facebook"]['#']}    Twitter: ${shares["buzzsumo:twitter"]['#']}    Pinterest: ${shares["buzzsumo:pinterest"]['#']}    Reddit: ${shares["buzzsumo:reddit"]['#']}

**Publication date:** ${item.pubDate}

_Data from Buzzsumo.com_`;

    const commonAttachmentOptions = {
        "author_name": message.author || item.author,
        "author_icon": message.authorIconUrl,
        "author_link": item.link,
        "title": item.title,
        "title_link": item.link,
        "color": message.color,
        "text": messageContent
    };

    const actionAttachmentOptions = {
        "actions": [
            {
                "name": "Send to [FR] Qualification channel",
                "integration": {
                    "url": mattermostConfig.actions.urls.sendToAnalysis,
                    "context": {
                        response_type: 'in_channel',
                        region: "fr", // we assume that for only french media-scale is available
                        shares: totalShares,
                        attachments: [commonAttachmentOptions],
                    }
                }
            },
            {
                "name": "Scale",
                "integration": {
                    "url": mattermostConfig.actions.urls.mediaScale,
                    "context": {
                        region: "fr", // we assume that for only french media-scale is available
                        shares: totalShares,
                        url: mattermostConfig.actions.urls.mediaScaleResponseUrl
                    }
                }
            }
        ]
    };

    const json = {
        response_type: 'in_channel',
        attachments: [Object.assign(actionAttachmentOptions, commonAttachmentOptions)],
    };

    console.log(`Article from ${message.author}: ${item.title}`)

    await request({
        url: mattermostConfig.incomingWebhookUrl,
        method: 'POST',
        json,
    }).then((response) => {
        db.get('posts')
            .push(item)
            .write();
    }).catch((e) => {
		console.error(e);
	});
}

module.exports = {
    init,
    handler
};
