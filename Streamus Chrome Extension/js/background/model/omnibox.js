﻿//  Displays streamus search suggestions and allows instant playing in the stream
define([
    'youTubeDataApi',
    'video',
    'videos',
    'utility',
    'streamItems',
    'player'
], function(YouTubeDataAPI, Video, Videos, Utility, StreamItems, Player) {
    'use strict';

    var Omnibox = Backbone.Model.extend({
            
        defaults: {
            suggestedVideos: new Videos,
        },
        
        initialize: function() {
            var self = this;
            
            //  User has started a keyword input session by typing the extension's keyword. This is guaranteed to be sent exactly once per input session, and before any onInputChanged events.
            chrome.omnibox.onInputChanged.addListener(function (text, suggest) {

                self.get('suggestedVideos').reset();

                var trimmedSearchText = $.trim(text);

                //  Clear suggestions if there is no text.
                if (trimmedSearchText === '') {

                    suggest();

                } else {

                    //  TODO: Maybe abort ajax requests during typing.
                    YouTubeDataAPI.search(trimmedSearchText, function (videoInformationList) {

                        var suggestions = _.map(videoInformationList, function (videoInformation) {

                            var video = new Video({
                                videoInformation: videoInformation
                            });
                            self.get('suggestedVideos').add(video);
                            
                            var label = video.get('prettyDuration') + "  " + video.get('title');

                            return { content: 'http://youtu.be/' + video.get('id'), description: Utility.htmlEscape(label) };
                        });

                        suggest(suggestions);

                    });

                }

            });

            chrome.omnibox.onInputEntered.addListener(function (text) {
                //  Find the cached video data by url
                var pickedVideo = self.get('suggestedVideos').find(function (suggestedVideo) {
                    var url = 'http://youtu.be/' + suggestedVideo.get('id');
                    return text === url;
                });
                
                StreamItems.add({
                    id: _.uniqueId('streamItem_'),
                    video: pickedVideo,
                    title: pickedVideo.get('title'),
                    videoImageUrl: 'http://img.youtube.com/vi/' + pickedVideo.get('id') + '/default.jpg',
                    selected: true
                });

                Player.play();

            });
            
        }
    });


    return new Omnibox;
});