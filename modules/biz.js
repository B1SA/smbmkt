/**
 * Biz Logic functions 
 * this module is a "Middleware" to talk with multiple backend systems
 * it also normalizes and combine the different data structures from B1 and ByD
 * so the output data has a standard b1 format.
 */

const request = require("request");
const fs = require("fs");
const path = require("path")
const uuid = require('uuid');

const sql = require("./sql")
const leo = require("./leo")
const normalize = require("./normalize")


const b1 = require("./erp/b1")
const byd = require("./erp/byd")


module.exports = {
    GetItems: function (query, callback) {
        return (GetItems(query, callback))
    },
    GetSalesOrders: function (options, callback) {
        return (GetSalesOrders(options, callback))
    },
    SimilarItems: function (body, callback) {
        return (SimilarItems(body, callback))
    },

    DownloadImage: function (uri, filename, callback) {
        return DownloadImage(uri, filename, callback)
    },

    RowToFile: function (row) {
        return (RowToFile(row))
    },
    FileToRow: function (file) {
        return (FileToRow(file))
    }
}

function SimilarItems(body, callback) {

    var output = {}
    console.log("Dowloading image from: " + body.url)
    DownloadImage(body.url, uuid.v4() + path.extname(body.url), function (imgPath) {

        console.log("Extracting Vector")
        leo.extractVectors(imgPath, function (error, vector) {
            if (error) {
                console.error(error)
                output.message = "Can't Extract vector for" + imgPath + " - " + error;
                callback(error, output)
            }

            console.log("Loading Vector Database")
            sql.Select(function (error, result) {
                if (error) {
                    console.error(error)
                    output.message = "Can't retrive vector database " + error;
                    callback(error, output)
                }
            })
        })
    })
}

function getSimilatiryScoring(vectors, callback) {
    vectors = JSON.parse(vectors);

    // Create e zip file of vectors to be used by the Similarity scoring service 
    var zipFile = uuid.v4() + '.zip';

    // create a file to stream archive data to the zip
    var output = fs.createWriteStream(path.join(process.env.TEMP_DIR, zipFile));
    var archive = archiver('zip', { zlib: { level: 9 } }); // Sets the compression level. 

    // listen for all archive data to be written 
    output.on('close', function () {
        console.log("Zip Created - " + zipFile)
        console.log("Time to call leonardo")
    });

    // good practice to catch warnings (ie stat failures and other non-blocking errors) 
    archive.on('warning', function (err) {
        if (err.code === 'ENOENT') {
            // log warning 
        } else {
            // throw error 
            throw err;
        }
    });

    // good practice to catch this error explicitly 
    archive.on('error', function (err) {
        throw err;
    });

    // pipe archive data to the file 
    archive.pipe(output);

    var buff = Buffer.from(JSON.stringify(vectors.predictions[0].feature_vector), "utf8");
    var fileName = vectors.predictions[0].name
    fileName = fileName.substr(0, fileName.indexOf('.')) + '.txt'
    archive.append(buff, { name: fileName });

    fs.readdirSync(process.env.VECTOR_DIR).forEach(file => {
        // append txt vector files from stream to the zip 
        if (file.indexOf('.txt') !== -1) {
            archive.append(fs.createReadStream(path.join(process.env.VECTOR_DIR, file)), { name: file });
        }
    })

    // finalize the archive (ie we are done appending files but streams have to finish yet) 
    archive.finalize();

}


function GetItems(query, callback) {
    byd.GetItems(query, function (error, itemsByD) {
        if (error) {
            itemsByD = {};
            itemsByD.error = error;
        }
        b1.GetItems(query, function (error, itemsB1) {
            if (error) {
                itemsB1 = {};
                itemsB1.error = error;
            }

            var output = {
                b1: { values: itemsB1.error || itemsB1.value },
                byd: { values: itemsByD.error || itemsByD.d.results }
            }

            if (itemsB1.hasOwnProperty("odata.nextLink")) {
                output.b1["odata.nextLink"] = itemsB1["odata.nextLink"];
            }
            callback(null, normalize.Items(output))
        })
    })
}

function GetSalesOrders(query, callback) {
    byd.GetSalesOrders(query, function (error, itemsByD) {
        b1.GetOrders(query, function (error, itemsB1) {
            var output = {
                b1: itemsB1.value,
                byd: itemsByD.d.results
            }
            callback(null, normalize.SalesOrders(output))
        })
    })
}


function DownloadImage(uri, filename, callback) {
    console.log("Downloading image from " + uri)
    request.head(uri, function (err, res, body) {
        var imgPath = path.join(process.env.TEMP_DIR, filename)
        request(uri).pipe(fs.createWriteStream(imgPath)).on('close', function () {
            callback(imgPath)
        });
    });
}

function RowToFile(row) {
    return row.origin + process.env.FILE_SEP + row.productid + path.extname(row.image)
}

function FileToRow(file) {
    var row = {}
    var sep = process.env.FILE_SEP
    var ext = path.extname(file);

    row.origin = file.substr(0, file.indexOf(sep))
    file = file.substr(file.indexOf(sep) + sep.length, file.indexOf(ext))
    row.productid = file.substr(0, file.indexOf(ext))

    return row
}