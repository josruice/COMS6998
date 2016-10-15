'use strict';

const _ = require('underscore');
const sprintf = require('sprintf-js').sprintf;

/***
 * DAO class which handles all data access related operations.
 * Expects a DynamoDB client object and a table name to be injected.
 ***/
module.exports = class Dao {

  constructor(dynamoDocClient, tableName) {
    this._tableName = tableName;
    this._dynamoDocClient = dynamoDocClient
  }

  /**
   * Persists object into DB
   * @item - Record to be persisted into DB
   * @callback - Callback function to which either error or data is passed back.
   * Argument to callback expected of the form(error, data)
   **/
  persist(key, item, callback) {

    var params = {
      TableName: this._tableName,
      Key: key
    };
    this._dynamoDocClient.get(params, function(err, data) {
      if (err) {
        console.error("Dynamo failed to persist data " + err);
        callback(err, null);
      } else {
        if (_.isEmpty(data)) {
          params = _.omit(params, 'Key');
          params.Item = item;
          this._dynamoDocClient.put(params, function(err, persistedData) {
            if (err) {
              console.error("Dynamo failed to persist data " + err);
              callback(err, null);
            } else {
              console.log("Successfully persited record into dynamo: " + JSON.stringify(item));
              callback(null, item);
            }
          });
        } else {
          throw "Item Already Exists";
        }
      }
    });
  }

  /**
   * Fetches object from DB
   * @key - Key on which record needs to be fetched from DB
   * @callback - Callback function to which either error or data is passed back.
   * Argument to callback expected of the form(error, data)
   **/
  fetch(key, callback) {

    var params = {
      TableName: this._tableName
    };
    if (key != null && key != "") {
      params.Key = key;

      this._dynamoDocClient.get(params, function(err, data) {
        if (err) {
          console.error("Dynamo failed to fetch data " + err);
          callback(err, null);
        } else {
          console.log("Successfully fetched record from dynamo: " + JSON.stringify(data));
          var item = data.Item;
          // This is necessary because we dont have a GSI on deleted field.
          // So we have to manually filter out the result
          if (!item || (item && item.deleted == true)) {
            item = {}
          }
          callback(null, item);
        }
      });

    } else {

      params.FilterExpression = "deleted = :value";
      params.ExpressionAttributeValues = { ":value": false };

      this._dynamoDocClient.scan(params, function(err, data) {
        if (err) {
          console.error("Dynamo failed to fetch data " + err);
          callback(err, null);
        } else {
          console.log("Successfully fetched record from dynamo: " + JSON.stringify(data));
          callback(null, data.Items);
        }
      });
    }
  }

  /**
   * Deletes object from DB
   * @key - Key on which record needs to be deleted from DB
   * @callback - Callback function to which either error or data is passed back.
   * Argument to callback expected of the form(error, data)
   **/
  delete(key, callback) {

    var params = {
      TableName: this._tableName,
      Key: key
    };

    this._dynamoDocClient.get(params, function(err, data) {
      if (err) {
        console.error("Dynamo failed to fetch data " + err);
        callback(err, null);
      } else {
        console.log("Successfully fetched record from dynamo: " + JSON.stringify(data));

        var item = data.Item;
        item.deleted = true;
        params.Item = item;

        this._dynamoDocClient.put(params, function(err, data) {
          if (err) {
            console.error("Dynamo failed to persist data " + err);
            callback(err, null);
          } else {
            console.log("Successfully deleted record from dynamo: " + JSON.stringify(item));
            callback(null, item);
          }
        });
      }
    });
  }

  /**
   * Updates object from DB
   * @key - Key on which record needs to be updated in DB
   * @newItem - Information to be updated in DB - contains list of key-value pairs that need to be updated - has to include PrimaryID
   * @callback - Callback function to which either error or data is passed back.
   * Argument to callback expected of the form(error, data)
   **/
  update(key, newItem, callback) {
    // Get object from Dynamo to compare first.
    this.fetch(key, (err, currentItem) => {
      if (err) {
        console.error(err);
        callback(err);
      } else {
        if (currentItem && _.isEmpty(currentItem)) {
          var errorMessage = "Unable to update a non-existing item.";
          console.error(errorMessage);
          callback(errorMessage);
        } else {
          var i = 0;
          var updateRequired = false;
          var expressionAttributeValues = {};
          var updateAssignments = [];

          _.each(_.keys(newItem), (key) => {
            if (currentItem[key] !== newItem[key]) {
              var attributeId = ":val" + i;
              updateAssignments.push(sprintf("%s = %s", key, attributeId));
              expressionAttributeValues[attributeId] = newItem[key];
              updateRequired = true;
              i++;
            }
          });

          var updateExpression = sprintf("SET %s", updateAssignments.join(', '));

          if (!updateRequired) {
            console.log("No new value given to any field. Nothing to update.");
            callback(null, currentItem);
            return;
          }

          console.log(sprintf("Using update expression: %s.", updateExpression));
          var params = {
            TableName: this._tableName,
            Key: key,
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            ReturnValues: "ALL_NEW"
          };

          this._dynamoDocClient.update(params, function(err, data) {
            if (err) {
              console.error("Dynamo failed to Update data " + err);
              callback(err, null);
            } else {
              console.log("Successfully updated record from dynamo: " + JSON.stringify(data));
              callback(null, data.Attributes);
            }
          });
        }
      }
    });
  }
};
