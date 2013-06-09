/**
 * @license
 * Copyright 2013 Dan Vanderkam (danvdk@gmail.com)
 * MIT-licensed (http://opensource.org/licenses/MIT)
 *
 * Note: This plugin requires jQuery and jQuery UI Draggable.
 *
 * See high-level documentation at
 * https://docs.google.com/document/d/1OHNE8BNNmMtFlRQ969DACIYIJ9VVJ7w3dSPRJDEeIew/edit#
 */

/*global Dygraph:false */

Dygraph.Plugins.Hairlines = (function() {

"use strict";

/**
 * @typedef {
 *   xval:  number,      // x-value (i.e. millis or a raw number)
 *   interpolated: bool,  // alternative is to snap to closest
 *   lineDiv: !Element    // vertical hairline div
 *   infoDiv: !Element    // div containing info about the nearest points
 * } Hairline
 */

// We have to wait a few ms after clicks to give the user a chance to
// double-click to unzoom. This sets that delay period.
var CLICK_DELAY_MS = 300;

var hairlines = function() {
  /* @type {!Array.<!Hairline>} */
  this.hairlines_ = [];

  // Used to detect resizes (which require the divs to be repositioned).
  this.lastWidth_ = -1;
  this.lastHeight = -1;
  this.dygraph_ = null;

  this.addTimer_ = null;
};

hairlines.prototype.toString = function() {
  return "Hairlines Plugin";
};

hairlines.prototype.activate = function(g) {
  this.dygraph_ = g;
  this.hairlines_ = [];

  return {
    didDrawChart: this.didDrawChart,
    click: this.click,
    dblclick: this.dblclick,
    dataWillUpdate: this.dataWillUpdate
  };
};

hairlines.prototype.detachLabels = function() {
  for (var i = 0; i < this.hairlines_.length; i++) {
    var h = this.hairlines_[i];
    $(h.lineDiv).remove();
    $(h.infoDiv).remove();
    this.hairlines_[i] = null;
  }
  this.hairlines_ = [];
};

hairlines.prototype.hairlineWasDragged = function(h, event, ui) {
  var area = this.dygraph_.getArea();
  var oldXVal = h.xval;
  h.xval = this.dygraph_.toDataXCoord(ui.position.left);
  this.moveHairlineToTop(h);
  this.updateHairlineDivPositions();
  this.updateHairlineInfo();
  $(this).triggerHandler('hairlineMoved', {
    oldXVal: oldXVal,
    newXVal: h.xval
  });
  $(this).triggerHandler('hairlinesChanged', {});
};

// This creates the hairline object and returns it.
// It does not position it and does not attach it to the chart.
hairlines.prototype.createHairline = function(xval) {
  var h;
  var self = this;

  var $lineContainerDiv = $('<div/>').css({
      'width': '6px',
      'margin-left': '-3px',
      'position': 'absolute',
      'z-index': '10'
    })
    .addClass('dygraph-hairline');

  var $lineDiv = $('<div/>').css({
    'width': '1px',
    'position': 'relative',
    'left': '3px',
    'background': 'black',
    'height': '100%'
  });
  $lineDiv.appendTo($lineContainerDiv);

  var $infoDiv = $('#hairline-template').clone().removeAttr('id').css({
      'position': 'absolute'
    })
    .show();

  // Surely there's a more jQuery-ish way to do this!
  $([$infoDiv.get(0), $lineContainerDiv.get(0)])
    .draggable({
      'axis': 'x',
      'drag': function(event, ui) {
        self.hairlineWasDragged(h, event, ui);
      }
      // TODO(danvk): set cursor here
    });

  h = {
    xval: xval,
    interpolated: true,
    lineDiv: $lineContainerDiv.get(0),
    infoDiv: $infoDiv.get(0)
  };

  var that = this;
  $infoDiv.on('click', '.hairline-kill-button', function() {
    that.removeHairline(h);
    $(that).triggerHandler('hairlineDeleted', {
      xval: h.xval
    });
    $(that).triggerHandler('hairlinesChanged', {});
  });

  return h;
};

// Moves a hairline's divs to the top of the z-ordering.
hairlines.prototype.moveHairlineToTop = function(h) {
  var div = this.dygraph_.graphDiv;
  $(h.infoDiv).appendTo(div);
  $(h.lineDiv).appendTo(div);

  var idx = this.hairlines_.indexOf(h);
  this.hairlines_.splice(idx, 1);
  this.hairlines_.push(h);
};

// Positions existing hairline divs.
hairlines.prototype.updateHairlineDivPositions = function() {
  var g = this.dygraph_;
  var layout = this.dygraph_.getArea();
  var div = this.dygraph_.graphDiv;
  var box = [layout.x + Dygraph.findPosX(div),
             layout.y + Dygraph.findPosY(div)];
  box.push(box[0] + layout.w);
  box.push(box[1] + layout.h);

  $.each(this.hairlines_, function(idx, h) {
    var left = g.toDomXCoord(h.xval);
    $(h.lineDiv).css({
      'left': left + 'px',
      'top': layout.y + 'px',
      'height': layout.h + 'px'
    });  // .draggable("option", "containment", box);
    $(h.infoDiv).css({
      'left': left + 'px',
      'top': layout.y + 'px',
    }).draggable("option", "containment", box);
  });
};

// Fills out the info div based on current coordinates.
hairlines.prototype.updateHairlineInfo = function() {
  var mode = 'closest';

  var g = this.dygraph_;
  var xRange = g.xAxisRange();
  $.each(this.hairlines_, function(idx, h) {
    var row = null;
    if (mode == 'closest') {
      // TODO(danvk): make this dygraphs method public
      row = g.findClosestRow(g.toDomXCoord(h.xval));
    } else if (mode == 'interpolate') {
      // ...
    }

    // To use generateLegendHTML, we have to synthesize an array of selected
    // points.
    var selPoints = [];
    var labels = g.getLabels();
    for (var i = 1; i < g.numColumns(); i++) {
      selPoints.push({
        canvasx: 1,
        canvasy: 1,
        xval: h.xval,
        yval: g.getValue(row, i),
        name: labels[i]
      });
    }

    var html = Dygraph.Plugins.Legend.generateLegendHTML(g, h.xval, selPoints, 10);
    $('.hairline-legend', h.infoDiv).html(html);
  });
};

// After a resize, the hairline divs can get dettached from the chart.
// This reattaches them.
hairlines.prototype.attachHairlinesToChart_ = function() {
  var div = this.dygraph_.graphDiv;
  $.each(this.hairlines_, function(idx, h) {
    $([h.lineDiv, h.infoDiv]).appendTo(div);
  });
};

// Deletes a hairline and removes it from the chart.
hairlines.prototype.removeHairline = function(h) {
  var idx = this.hairlines_.indexOf(h);
  if (idx >= 0) {
    this.hairlines_.splice(idx, 1);
    $([h.lineDiv, h.infoDiv]).remove();
  } else {
    Dygraph.warn('Tried to remove non-existent hairline.');
  }
};

hairlines.prototype.didDrawChart = function(e) {
  var g = e.dygraph;

  // Early out in the (common) case of zero hairlines.
  if (this.hairlines_.length === 0) return;

  // See comments in this.dataWillUpdate for an explanation of this block.
  $.each(this.hairlines_, function(idx, h) {
    if (h.hasOwnProperty('domX')) {
      h.xval = g.toDataXCoord(h.domX);
      delete h.domX;
      console.log('h.xval: ', h.xval);
    }
  });

  this.updateHairlineDivPositions();
  this.attachHairlinesToChart_();
  this.updateHairlineInfo();
};

hairlines.prototype.dataWillUpdate = function(e) {
  // When the data in the chart updates, the hairlines should stay in the same
  // position on the screen. To do this, we add a 'domX' parameter to each
  // hairline when the data updates. This will get translated back into an
  // x-value on the next call to didDrawChart.
  var g = this.dygraph_;
  $.each(this.hairlines_, function(idx, h) {
    h.domX = g.toDomXCoord(h.xval);
    console.log('h.domX = ', h.domX, 'h.xval = ', h.xval);
  });
};

hairlines.prototype.click = function(e) {
  if (this.addTimer_) {
    // Another click is in progress; ignore this one.
    return;
  }

  var area = e.dygraph.getArea();
  var xval = this.dygraph_.toDataXCoord(e.canvasx);

  var that = this;
  this.addTimer_ = setTimeout(function() {
    that.addTimer_ = null;
    that.hairlines_.push(that.createHairline(xval));

    that.updateHairlineDivPositions();
    that.updateHairlineInfo();
    that.attachHairlinesToChart_();

    $(that).triggerHandler('hairlineCreated', {
      xval: xval
    });
    $(that).triggerHandler('hairlinesChanged', {});
  }, CLICK_DELAY_MS);
};

hairlines.prototype.dblclick = function(e) {
  if (this.addTimer_) {
    clearTimeout(this.addTimer_);
    this.addTimer_ = null;
  }
};

hairlines.prototype.destroy = function() {
  this.detachLabels();
};


// Public API

/**
 * This is a restricted view of this.hairlines_ which doesn't expose
 * implementation details like the handle divs.
 *
 * @typedef {
 *   xval:  number,       // x-value (i.e. millis or a raw number)
 *   interpolated: bool   // alternative is to snap to closest
 * } PublicHairline
 */

/**
 * @return {!Array.<!PublicHairline>} The current set of hairlines, ordered
 *     from back to front.
 */
hairlines.prototype.get = function() {
  var result = [];
  for (var i = 0; i < this.hairlines_.length; i++) {
    var h = this.hairlines_[i];
    result.push({
      xval: h.xval,
      interpolated: h.interpolated
    });
  }
  return result;
};

/**
 * Calling this will result in a hairlinesChanged event being triggered, no
 * matter whether it consists of additions, deletions, moves or no changes at
 * all.
 *
 * @param {!Array.<!PublicHairline>} hairlines The new set of hairlines,
 *     ordered from back to front.
 */
hairlines.prototype.set = function(hairlines) {
  // Re-use divs from the old hairlines array so far as we can.
  // They're already correctly z-ordered.
  var anyCreated = false;
  for (var i = 0; i < hairlines.length; i++) {
    var h = hairlines[i];

    if (this.hairlines_.length > i) {
      this.hairlines_[i].xval = h.xval;
      this.hairlines_[i].interpolated = h.interpolated;
    } else {
      // TODO(danvk): pass in |interpolated| value.
      this.hairlines_.push(this.createHairline(h.xval));
      anyCreated = true;
    }
  }

  // If there are any remaining hairlines, destroy them.
  while (hairlines.length < this.hairlines_.length) {
    this.removeHairline(this.hairlines_[hairlines.length]);
  }

  this.updateHairlineDivPositions();
  this.updateHairlineInfo();
  if (anyCreated) {
    this.attachHairlinesToChart_();
  }

  $(this).triggerHandler('hairlinesChanged', {});
};

return hairlines;

})();
