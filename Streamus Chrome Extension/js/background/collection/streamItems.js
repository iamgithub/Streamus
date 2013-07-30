﻿var StreamItems;

define(['streamItem', 'settingsManager', 'repeatButtonState', 'ytHelper', 'video', 'helpers'], function(StreamItem, settingsManager, RepeatButtonState, ytHelper, Video, helpers) {
    'use strict';

    var streamItemsCollection = Backbone.Collection.extend({
        model: StreamItem,

        initialize: function () {
            //  TODO: Probably make a stream model instead of extending streamItems
            //  Give StreamItems a history: https://github.com/jashkenas/backbone/issues/1442
            _.extend(this, { history: [] });
            _.extend(this, { bannedVideoIdList: [] });

            var self = this;

            this.on('add', function (addedStreamItem) {
                //  Ensure only one streamItem is selected at a time by de-selecting all other selected streamItems.
                if (addedStreamItem.get('selected')) {
                    addedStreamItem.trigger('change:selected', addedStreamItem, true);
                }

                //  If the Stream has any items in it, one should be selected.
                if (self.length === 1) {
                    addedStreamItem.set('selected', true);
                }

                var videoId = addedStreamItem.get('video').get('id');

                ytHelper.getRelatedVideoInformation(videoId, function(relatedVideoInformation) {
                    addedStreamItem.set('relatedVideoInformation', relatedVideoInformation);
                });

            });

            this.on('change:selected', function(changedStreamItem, selected) {

                //  Ensure only one streamItem is selected at a time by de-selecting all other selected streamItems.
                if (selected) {
                    this.deselectAllExcept(changedStreamItem.cid);
                }

            });

            this.on('remove', function(removedStreamItem, collection, options) {
                if (this.length === 0) {
                    this.trigger('empty');
                }

                if (removedStreamItem.get('selected') && this.length > 0) {
                    this.selectNext(options.index);
                }
            });

            this.on('change:playedRecently', function() {

                //  When all streamItems have been played recently, reset to not having been played recently.
                //  Allows for de-prioritization of played streamItems during shuffling.
                if (self.where({ playedRecently: true }).length === this.length) {
                    self.each(function(streamItem) {
                        streamItem.set('playedRecently', false);
                    });
                }

            });

        },

        addMultiple: function(streamItems) {

            //  Handling this manually to not clog the network with getVideoInformation requests
            this.add(streamItems, { silent: true });

            var self = this;
            //  Fetch from collection to make sure references stay correct + leverage conversion to model
            var streamItemsFromCollection = _.map(streamItems, function (streamItem) {
                var streamItemId;

                if (streamItem instanceof Backbone.Model) {
                    streamItemId = streamItem.get('id');
                } else {
                    streamItemId = streamItem.id;
                }

                return self.get(streamItemId);
            });
            
            var selectedStreamItem = this.getSelectedItem();

            if (selectedStreamItem === null) {
                //  If the Stream has any items in it, one should be selected.
                this.at(0).set('selected', true);
            }

            //  TODO: Could probably be improved for very large playlists being added.
            //  Take a statistically significant sample of the videos added and fetch their relatedVideo information.
            var sampleSize = streamItemsFromCollection.length >= 50 ? 50 : streamItemsFromCollection.length;
            var randomSampleIndices = helpers.getRandomNonOverlappingNumbers(sampleSize, streamItemsFromCollection.length);

            var randomVideoIds = _.map(randomSampleIndices, function (randomSampleIndex) {
                return streamItemsFromCollection[randomSampleIndex].get('video').get('id');
            });

            //  Fetch all the related videos for videos on load. I don't want to save these to the DB because they're bulky and constantly change.
            //  Data won't appear immediately as it is an async request, I just want to get the process started now.
            ytHelper.getBulkRelatedVideoInformation(randomVideoIds, function (bulkInformationList) {

                _.each(bulkInformationList, function (bulkInformation) {
                    var videoId = bulkInformation.videoId;

                    var streamItem = _.find(streamItemsFromCollection, function (streamItemFromCollection) {
                        return streamItemFromCollection.get('video').get('id') === videoId;
                    });

                    streamItem.set('relatedVideoInformation', bulkInformation.relatedVideoInformation);

                });
                
            });

            this.trigger('addMultiple', streamItemsFromCollection);
        },

        deselectAllExcept: function(streamItemCid) {

            this.each(function(streamItem) {

                if (streamItem.cid != streamItemCid) {
                    streamItem.set('selected', false);
                }

            });

        },

        getSelectedItem: function () {
            return this.findWhere({ selected: true }) || null;
        },
        
        //  Take each streamItem's array of related videos, pluck them all out into a collection of arrays
        //  then flatten the arrays into a collection of videos.
        getRelatedVideos: function() {

            var relatedVideos = _.flatten(this.map(function (streamItem) {

                return _.map(streamItem.get('relatedVideoInformation'), function (relatedVideoInformation) {

                    return new Video({
                        videoInformation: relatedVideoInformation
                    });

                });

            }));

            //  Don't add any videos that are already in the stream.
            var self = this;

            relatedVideos = _.filter(relatedVideos, function (relatedVideo) {
                var alreadyExistingItem = self.find(function (streamItem) {

                    var sameVideoId = streamItem.get('video').get('id') === relatedVideo.get('id');

                    var inBanList = _.contains(self.bannedVideoIdList, relatedVideo.get('id'));
                    //  TODO: I don't think this does quite what I want it to do.
                    //var similiarVideoName = levDistance(item.get('video').get('title'), relatedVideo.get('title')) < 3;

                    return sameVideoId || inBanList; // || similiarVideoName;
                });

                return alreadyExistingItem == null;
            });

            // Try to filter out 'playlist' songs, but if they all get filtered out then back out of this assumption.
            var tempFilteredRelatedVideos = _.filter(relatedVideos, function (relatedVideo) {
                //  assuming things >8m are playlists.
                var isJustOneSong = relatedVideo.get('duration') < 480;
                var isNotLive = relatedVideo.get('title').toLowerCase().indexOf('live') === -1;

                return isJustOneSong && isNotLive;
            });

            if (tempFilteredRelatedVideos.length !== 0) {
                relatedVideos = tempFilteredRelatedVideos;
            }

            return relatedVideos;
        },

        getRandomRelatedVideo: function() {

            var relatedVideos = this.getRelatedVideos();

            var groupedRelatedVideoLists = _.groupBy(relatedVideos, function (relatedVideo) {
                return relatedVideo.get('id');
            });

            var videoArrayLengths = _.pluck(groupedRelatedVideoLists, 'length');

            //  Grouping the related videos will allow us to select the array with the highest number of occurrances and grab a random video from there.
            //  In this way we grab the 'most related for playlist' because it is part of the group of videos which are most related by occurrance.
            var maxNumberOfOccurrances = _.max(videoArrayLengths, function (videoArrayLength) {
                return videoArrayLength;
            });

            //  These arrays contain the duplicates of videos in which we should select. Grab one, grab a video from it and go.
            var maxLengthRelatedVideos = _.filter(groupedRelatedVideoLists, function (groupedRelatedVideoList) {
                return groupedRelatedVideoList.length === maxNumberOfOccurrances;
            });

            var relatedVideo = maxLengthRelatedVideos[_.random(maxLengthRelatedVideos.length - 1)][0];

            return relatedVideo;
        },
        
        //  If a streamItem which was selected is removed, selectNext will have a removedSelectedItemIndex provided
        selectNext: function(removedSelectedItemIndex) {

            var shuffleEnabled = settingsManager.get('shuffleEnabled');
            var radioModeEnabled = settingsManager.get('radioModeEnabled');
            var repeatButtonState = settingsManager.get('repeatButtonState');

            //  If removedSelectedItemIndex is provided, RepeatButtonState -> Video doesn't matter because the video was just deleted.
            if (removedSelectedItemIndex === undefined && repeatButtonState === RepeatButtonState.REPEAT_VIDEO_ENABLED) {
                var selectedItem = this.findWhere({ selected: true });
                selectedItem.trigger('change:selected', selectedItem, true);
            } else if (shuffleEnabled) {

                var shuffledItems = _.shuffle(this.where({ playedRecently: false }));
                shuffledItems[0].set('selected', true);
            } else {

                var nextItemIndex;

                if (removedSelectedItemIndex !== undefined && removedSelectedItemIndex !== null) {
                    nextItemIndex = removedSelectedItemIndex;
                } else {
                    nextItemIndex = this.indexOf(this.findWhere({ selected: true })) + 1;
                    if (nextItemIndex <= 0) throw "Failed to find nextItemIndex";
                }

                //  Select the next item by index. Potentially loop around to the front.
                if (nextItemIndex === this.length) {

                    if (repeatButtonState === RepeatButtonState.REPEAT_STREAM_ENABLED) {
                        this.at(0).set('selected', true);

                        //  TODO: Might be sending an erroneous trigger on delete?
                        //  Only one item in the playlist and it was already selected, resend selected trigger.
                        if (this.length == 1) {
                            this.at(0).trigger('change:selected', this.at(0), true);
                        }
                    } else if (radioModeEnabled) {

                        var randomRelatedVideo = this.getRandomRelatedVideo();

                        console.log("Adding random related video and marking it as selected");

                        this.add({
                            video: randomRelatedVideo,
                            title: randomRelatedVideo.get('title'),
                            videoImageUrl: 'http://img.youtube.com/vi/' + randomRelatedVideo.get('id') + '/default.jpg',
                            selected: true
                        });

                    }

                } else {
                    this.at(nextItemIndex).set('selected', true);
                }

            }

        },

        selectPrevious: function() {

            //  Peel off currentStreamItem from the top of history.
            this.history.shift();
            var previousStreamItem = this.history.shift();

            //  If no previous item was found in the history, then just go back one item
            if (previousStreamItem == null) {

                var repeatButtonState = settingsManager.get('repeatButtonState');

                if (repeatButtonState === RepeatButtonState.REPEAT_VIDEO_ENABLED) {
                    var selectedItem = this.findWhere({ selected: true });
                    selectedItem.trigger('change:selected', selectedItem, true);
                } else if (settingsManager.get('shuffleEnabled')) {

                    var shuffledItems = _.shuffle(this.where({ playedRecently: false }));
                    shuffledItems[0].set('selected', true);

                } else {
                    //  Select the previous item by index. Potentially loop around to the back.
                    var selectedItemIndex = this.indexOf(this.findWhere({ selected: true }));

                    if (selectedItemIndex === 0) {

                        if (repeatButtonState === RepeatButtonState.REPEAT_STREAM_ENABLED) {
                            this.at(this.length - 1).set('selected', true);
                        }

                    } else {
                        this.at(selectedItemIndex - 1).set('selected', true);
                    }

                }

            } else {
                previousStreamItem.set('selected', true);
            }
        },
        
        ban: function (streamItem) {
            this.bannedVideoIdList.push(streamItem.get('video').get('id'));
            console.log("BanendVideoIdList:", this.bannedVideoIdList);
        },
        
        clear: function() {
            this.bannedVideoIdList = [];
            this.reset();
            this.trigger('empty');
        }
    });

    StreamItems = new streamItemsCollection;

    return StreamItems;
});