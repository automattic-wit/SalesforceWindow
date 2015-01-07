(function() {

  return {
    events: {
      'app.activated'  : 'init',
      'click .set-bpe' : 'setBPE'
    },
    
    requests: {

        getFullInfo: function(options) {
            return {
                url: '/api/v2/' + options.object + '/' + options.id + '.json',
                type:'GET',
                dataType: 'json'
            };
        },

        callZendeskAPI: function(options) {
            return {
                url      : '/api/v2/' + options.object + '/' + options.id + '.json',
                type     : options.method,
                dataType : 'json',
                data     : options.data
            };
        },
    
        accessSalesforce: function() {
            return {
                url: 'https://login.salesforce.com/services/oauth2/token',
                type: 'POST',
                dataType: 'json',
                data: {
                    grant_type    : 'refresh_token',
                    client_id     : "{{setting.consumer_key}}",       // this.KEY,
                    client_secret : "{{setting.consumer_secret}}",    // this.SECRET,
                    refresh_token : "{{setting.refresh_token}}"       // this.TOKEN
                }
            };
        },
        
        getSFEvents: function(identifiers) {
            var query = '';
            query += 'SELECT Id,Event_Code__c,Organization_Name__r.Name,Event_Date__c,Event_Type__c,FriendlyURL__c,Event_City__c,Time_Zone__c,Planner_Admin__r.Name,Name,';                                 // General
            query +=        'Merchant_ID__c,iATS_Opportunity_Status__c,';     // iATS
            query +=        'AP_Contact_Email__c,AP_Contact_First_Name__c,AP_Contact_Last_Name__c,';                                                                                          // AP Contact
            query +=        'Beta_Confirmed__c,BidBox_Name__c,Total_Connections__c,Planned_APs__c,Payment_Processing_Y_N__c,myBidPal_Portal__c,';                                                           // BP Products
            query +=        'Registration_Silent_auction_start__c,Silent_auction_end__c,Donation_end__c,Setup_Start_Time__c,Event_Manager_start__c,';                                                       // Times
            query +=        'Venue_Name__c,Venue_Internet_Used__c,Venue_Contact__c,';   // Venue
            query +=        'Delivery_Driver__c,Pickup_Driver__c,';                     // Logistics... may need to pull off of Event_Equipment__r
            query +=        'Setup_Notes__c';                                           // Notes

            query += ' FROM Event__c ';

            query += ' WHERE ' + identifiers.fieldName;

            if(identifiers.fieldName == 'Organization_Name__r.Name')  query += ' LIKE \'%';
            else                                                                 query += '=\'';

            query += identifiers.uniqueId;

            if(identifiers.fieldName == 'Organization_Name__r.Name')  query += '%';

            query += '\'';

            if(identifiers.fieldName != 'Event_Code__c')
                query += '  AND  (Event_Date__c >= LAST_N_YEARS:1  AND  Event_Date__c <= NEXT_N_YEARS:2) ';

            query += ' ORDER BY Event_Date__c ASC ';
            query += ' LIMIT 10 ';


            return {
                url: this.salesforce_instance_url + '/services/data/v20.0/query',
                type: 'GET',
                dataType: 'json',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.salesforce_access_token
                },
                data: { q: query}
            };
        },
        
        getSFEventStaff: function(eventId) {
            var query = '';
            query +=  'SELECT Id,Staff_Role__c,Staff_Name__c,Staff_Mobile__c';
            query += ' FROM Event_Staff__c';
            query += ' WHERE Event__c=\'' + eventId + '\'' ;

            return {
                url: this.salesforce_instance_url + '/services/data/v20.0/query',
                type: 'GET',
                dataType: 'json',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.salesforce_access_token
                },
                data: { q: query}
            };
        },
        
        getSFEventEquipment: function(eventId) {
            var query = '';
            query +=  'SELECT Id,Equipment_Type__c,Equipment_Name__c';
            query += ' FROM Event_Equipment__c';
            query += ' WHERE Event__c=\'' + eventId + '\' AND Type__c = \'Event\'';
            query += ' ORDER BY Equipment_Type__c, Equipment_Name__c';

            return {
                url: this.salesforce_instance_url + '/services/data/v20.0/query',
                type: 'GET',
                dataType: 'json',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + this.salesforce_access_token
                },
                data: { q: query}
            };
        }

    },



    // Member Vars
    after_salesforce_accessed       : [],    // to store list of Functions to be called upon successful SF Authentication
    is_requesting_salesforce_access : null,
    salesforce_access_token         : null,
    salesforce_instance_url         : null,

    query_sf_field  : null,     // Used to store found pieces of the WHERE clause in case authentication has not yet happened
    query_unique_id : null,

    organization_name: null,    // Used to store the org name, to search with when all else fails

    
    
    // Handle Settings, start app, logic, etc.
    
    formatNeatOutput: function() {

        // Format Neat Dates
        // @assumption - the html element has a specific structure
        //             - class: format-neat-date
        //             - data:  data-date-string
        //             - html:  a loading message (ex: "formatting date...") to be replaced with formated date
        var needingDateFormatting = this.$('.mjw-format-neat-date');
        _.each(needingDateFormatting, function(element) {
            element = this.$(element);

            var dateString = element.data('dateString');
            if(!dateString) 
                element.html('[None Found]');
            else {
                var date = new Date(dateString);
                // EST Storage Bias Offset = 4days * 60minutes * 60seconds * 1000milliseconds
                date = new Date( date.getTime() - 4*60*60*1000 );

                var month = date.getUTCMonth() + 1;    month = (month < 10  ?  '0' + month  :  month);
                var day   = date.getUTCDate();         day   = (day   < 10  ?  '0' + day    :  day  );

                element.html(  month + '/' + day + '/' + date.getFullYear()  );
            }
        });


        // Format Neat Times
        // @assumption - the html element has a specific structure
        //             - class: format-neat-time
        //             - data:  data-date-string
        //             - html:  a loading message (ex: "formatting time...") to be replaced with formated date
        var needingTimeFormatting = this.$('.mjw-format-neat-time');
        _.each(needingTimeFormatting, function(element) {
            element = this.$(element);

            var dateString = element.data('dateString');
            if(!dateString) 
                element.html('[None Found]');
            else {
                var date = new Date(dateString);
                // EST Storage Bias Offset = 4days * 60minutes * 60seconds * 1000milliseconds
                date = new Date( date.getTime() - 4*60*60*1000 );

                var hour = date.getUTCHours();
                var min  = date.getUTCMinutes();
                var ampm = (hour > 12  ?  'PM'       :  'AM');
                hour     = (hour > 12  ?  hour - 12  :  hour);
                min      = (min  > 0   ?  min        : '00');

                element.html(hour + ':' + min + ' ' + ampm);
            }
        });


        // Set Icons
        // @assumption - the html element has a specific structure
        var needingIconSet = this.$('.mjw-format-set-icon');
        _.each(needingIconSet, function(element) {
            element = this.$(element);
            
            var iconIndicator = element.data('iconAssociate');
            
            if(iconIndicator == 'Wi-Fi'   )  element.addClass('fa-wifi'  );
            if(iconIndicator == 'Hybrid'  )  element.addClass('fa-cloud' );
            if(iconIndicator == 'Cellular')  element.addClass('fa-mobile');
            if(iconIndicator == 'DIY'     )  element.addClass('fa-wrench');
            if(iconIndicator == 'None'    )  element.addClass('fa-times' );
        });
    },



    init: function() {
        // Set Settings Variables
        //@FUTURE---REMOVE (most of) THESE, AND USE SECURE TEMPLATING... @FUTURE---make sure this works
        // this.KEY          = this.setting('consumer_key');
        // this.SECRET       = this.setting('consumer_secret');
        this.BPE_FIELD_ID = this.setting('bpe_field_id');
        //this.TOKEN        = this.setting('refresh_token');

        
        // Start SF Auth process
        this.accessSalesforce({backgroundProcess: true});

        // Make App Do Things
        this.switchTo('working_status', {message: 'Fetching Events...'});
        this.fetchSFEvents();
    },
    
    
    
    // OAuth to Salesforce
    
    accessSalesforce: function(options) {
        // If Necessary, Inform User of Progress
        if( options  &&  (! options.backgroundProcess) )
            this.switchTo( 'working_status',  {message: (options.statusMsg  ?  options.statusMsg+' '  :  '') + (this.is_requesting_salesforce_access  ?  'Access Request Pending...'  :  'Accessing Salesforce')} );
            
        // Push all after Function Calls into an attribute list.
        // This way if there are multiple accessSalesforce function calls, only 1 AJAX call will ever go out at a time,
        // while the callbacks are quietly stored waiting for the AJAX to return
        if(options  &&  options.after) {  
            this.after_salesforce_accessed.push(options.after);  
        }

        if( ! this.is_requesting_salesforce_access ) {
            this.is_requesting_salesforce_access = true;
            
            var accessRequest = this.ajax('accessSalesforce');
            accessRequest.done( this.salesforceAccessed );
            accessRequest.fail( this.showError          );
        }
    },

    salesforceAccessed: function(ajaxResponse) {
        this.salesforce_access_token         = ajaxResponse.access_token;
        this.salesforce_instance_url         = ajaxResponse.instance_url;
        this.is_requesting_salesforce_access = false;

        // Call Each Stored After Function
        for(var index = 0;  index < this.after_salesforce_accessed.length;  index++) {
            var after = this.after_salesforce_accessed[index];
            var tempFunction = after.method;
            var parameters   = after.params;
            parameters.thisOverride = this;     //@FUTURE---this may run into problems when options/params are undefined
            tempFunction(parameters);
        }

        // Remove/Reset Each Stored After Funciton
        this.after_salesforce_accessed = [];
    },
    
    
    
    // Fetch Salesforce Events
    
    fetchSFEvents: function() {
        // Check for BPE
        var bpe = this.ticket().customField('custom_field_' + this.BPE_FIELD_ID);
        
        if(bpe)
            this.fetchSFEvents_getRecords({bpe: bpe});
        else {  // Begin Search for SF Org Id
            
            // Use API to get Full Ticket Info (for Zendesk.Org.IntacctId)
            this.switchTo('working_status', {message: 'Accessing Ticket Information...'});
            
            var ticketRequest = this.ajax('getFullInfo', {object: 'tickets', id: this.ticket().id()});
            ticketRequest.done( this.fetchSFEvents_processTicket );
            ticketRequest.fail( this.showError                   );
        }
    },
    

    fetchSFEvents_getRecords: function(options) {
        //console.log('fetchSFEvents_getRecords options', options);
        var specializedThis = (options && options.thisOverride  ?  options.thisOverride  :  this);

        // Check Options for Possible Query Info (set to this)
        if(options  &&  options.bpe         )  {  specializedThis.query_sf_field = 'Event_Code__c';                                             specializedThis.query_unique_id = options.bpe;           }
        if(options  &&  options.intacctId   )  {  specializedThis.query_sf_field = 'Organization_Name__r.IntacctID__c';                         specializedThis.query_unique_id = options.intacctId;     }
        if(options  &&  options.zendeskOrgId)  {  specializedThis.query_sf_field = 'Organization_Name__r.Zendesk__Zendesk_Organization_Id__c';  specializedThis.query_unique_id = options.zendeskOrgId;  }
        if(options  &&  options.orgName     )  {  specializedThis.query_sf_field = 'Organization_Name__r.Name';                                 specializedThis.query_unique_id = options.orgName;       }
        
        if( ! specializedThis.salesforce_access_token ) {
            specializedThis.accessSalesforce({
                after             : {
                    method : specializedThis.fetchSFEvents_getRecords,
                    params : options
                },
                backgroundProcess : (options  ?  options.backgroundProcess  :  undefined), 
                statusMsg         : (options  ?  options.statusMsg          :  undefined)
            });
        }
        else {
            if( options && (! options.backgroundProcess) )
                specializedThis.switchTo('working_status', {message: (options.statusMsg  ?  options.statusMsg+' '  :  '') + 'Fetching Event Records...'});
            
            // Build Identifiers based on Object (this) Properties
            var identifiers = {
                fieldName : specializedThis.query_sf_field,
                uniqueId  : specializedThis.query_unique_id
            };
            
            var SFEventsRequest = specializedThis.ajax('getSFEvents', identifiers);
            SFEventsRequest.done(options.doneFunction  ?  options.doneFunction  :  specializedThis.fetchSFEvents_processSFEvents);
            SFEventsRequest.fail(specializedThis.showError);
        }
    },


    // Attempt #0 - Retrieve Salesforce Event - BPE
    fetchSFEvents_processSFEvents: function(ajaxResponse) {
        //console.log('fetchSFEvents_processSFEvents ajaxResponse', ajaxResponse);

        if(ajaxResponse && ajaxResponse.totalSize) {

            if(ajaxResponse.totalSize > 1)
                this.showSalesforceEvents({ajaxResponse: ajaxResponse, template: 'list_events'});
            else    // A single event      //@FUTURE---Consider removing title attr... its currently not used in display_event template
                this.showSalesforceEvents({ajaxResponse: ajaxResponse, title: 'Search By BPE', template: 'display_event'});
        }
        else {
            // This literally should never happen unless a BPE is incorrect
            this.switchTo('working_status', {message: 'Search by Zendesk Organization Id yielded no results.  Accessing Full Ticket Information...'});
            var ticketRequest = this.ajax('getFullInfo', {object: 'tickets', id: this.ticket().id()});
            ticketRequest.done( this.fetchSFEvents_processTicket );
            ticketRequest.fail( this.showError                   );
        }
    },


    fetchSFEvents_processTicket: function(ajaxResponse) {
        //console.log('fetchSFEvents_processTicket', ajaxResponse);

        if(ajaxResponse.ticket  &&  ajaxResponse.ticket.organization_id) {
            this.switchTo('working_status', {message: 'Ticket Information Found.  Looking for Events by Zendesk Organiztion Id...'});
            this.fetchSFEvents_getRecords({
                zendeskOrgId : ajaxResponse.ticket.organization_id, 
                doneFunction : this.fetchSFEvents_processZendeskOrgIdAttempt
            });
        }
        else  this.showNoOrganizationMessage();
    },


    // Attempt #1 - Retrieve Salesforce Events - Zendesk Organization Id
    fetchSFEvents_processZendeskOrgIdAttempt: function(ajaxResponse) {
        //console.log('fetchSFEvents_processZendeskOrgIdAttempt', ajaxResponse);

        if(ajaxResponse && ajaxResponse.totalSize)
            this.showSalesforceEvents({ajaxResponse: ajaxResponse, title: 'Search By Zendesk Organization Id'});
        else {
            this.switchTo('working_status', {message: 'Search by Zendesk Organization Id yielded no results.  Accessing Full Organization Information...'});
            var organizationRequest = this.ajax('getFullInfo', {object: 'organizations', id: this.query_unique_id});    // this.query_unique_id currently holds the zendesk org id
            organizationRequest.done( this.fetchSFEvents_processOrganization );
            organizationRequest.fail( this.showError                         );
        }
    },

    
    fetchSFEvents_processOrganization: function(ajaxResponse) {
        //console.log('fetchSFEvents_processOrganization', ajaxResponse);

        if(ajaxResponse.organization)  {
            if(ajaxResponse.organization.name)    this.organization_name = ajaxResponse.organization.name;

            if(ajaxResponse.organization.organization_fields  &&  ajaxResponse.organization.organization_fields.intacct_customer_id) {
                this.fetchSFEvents_getRecords({
                    statusMsg: 'Organization Information Found.',
                    intacctId: ajaxResponse.organization.organization_fields.intacct_customer_id,
                    doneFunction: this.fetchSFEvents_processIntacctIdAttempt
                });
            }
            else  this.fetchSFEvents_byOrgName('No Intacct Id synced.');
        }
        else  this.showNoOrganizationMessage();
        
    },
    

    // Attempt #2 - Retrieve Salesforce Events - Intacct Id
    fetchSFEvents_processIntacctIdAttempt: function(ajaxResponse) {
        if(ajaxResponse && ajaxResponse.totalSize)
            this.showSalesforceEvents({ajaxResponse: ajaxResponse, title: 'Search By Intacct Id'});
        else
            this.fetchSFEvents_byOrgName('Sorry, search by Intacct Id yielded no results.');
    },


    //Attempt #3/4 - Retrieve Salesforce Events - Organization Name
    fetchSFEvents_byOrgName: function(statusMsg) {
        //console.log('fetchSFEvents_byOrgName', this.organization_name);
        this.switchTo('working_status', {context: 'info', message: (statusMsg  ?  statusMsg+'  '  :  '') + 'Attempting search by Organiztion Name...'});

        if(this.organization_name) {
            if(this.organization_name.indexOf('BidPal') >= 0)
                this.switchTo('working_status', {
                    context: 'warning',
                    message: 'Hey I noticed the requestor on this ticket is a BidPal Employee, change the requestor to a customer or enter the BPE, and refesh the application.',
                    technicalDetails: 'without this I can only find BidPal Engineering events, test events, etc.'
                });
            else
                this.fetchSFEvents_getRecords({
                    statusMsg: 'Searching by Name...',
                    orgName: this.organization_name,
                    doneFunction: this.fetchSFEvents_processOrgNameAttempt
                });
        }
        else {
            this.showNoOrganizationMessage('No Organiztion Name found with which to search.');
        }
    },


    fetchSFEvents_processOrgNameAttempt: function(ajaxResponse) {
        //console.log('fetchSFEvents_processOrgNameAttempt', ajaxResponse);
        this.showSalesforceEvents({ajaxResponse: ajaxResponse, template: 'list_events'});   // Note: the template checks for an empty result set, and displays an appropriate message
    },
    
    


    // "Template Injectors" - Update UI

    // Event Staff
    updateUI_EventStaff: function(ajaxResponse) {
        var container = this.$('.mjw-container-event-staff');
        if( ! ajaxResponse.totalSize )
            container.html('[None Found]');
        else {
            container.html('');
            _.each(ajaxResponse.records, function (staffing){
                var row = this.$('<div class="mjw-row mjw-clearfix"></div>');
                row.append('<div class="mjw-float-left" >' + staffing.Staff_Role__c + '</div>');
                row.append('<div class="mjw-float-right"><i class="fa fa-user"></i> ' + staffing.Staff_Name__c + ' &nbsp;&nbsp; <i class="fa fa-mobile"></i> ' + staffing.Staff_Mobile__c + '</div>');
                container.append(row);
            });
        }
    },

    // Event Equipment
    updateUI_EventEquipment: function(ajaxResponse) {
        var container = this.$('.mjw-container-event-equipment');
        if( ! ajaxResponse.totalSize )
            container.html('[No Equipment Planning Found]');
        else {
            container.html('');
            _.each(ajaxResponse.records, function (planning){
                var row = this.$('<div class="mjw-row mjw-clearfix"></div>');
                row.append('<div class="mjw-float-left" >' + planning.Equipment_Type__c + '</div>');
                row.append('<div class="mjw-float-right">' + planning.Equipment_Name__c + '</div>');
                container.append(row);
            });
        }
    },




    
    // Reused Template Swtiches

    

    showSalesforceEvents: function(data) {

        // Stringify each of the records for storage in the list view data, for later access when BPE choosen by user
        if(data.ajaxResponse && data.ajaxResponse.totalSize) {
            _.each(data.ajaxResponse.records, function(record) {
                record.stringified = JSON.stringify(record);
            });
        }

        this.switchTo((data.template  ?  data.template  :  'list_events'), data);
        this.formatNeatOutput();
        
        if(data.template == 'display_event') {
            var eventId = data.ajaxResponse.records[0].Id;

            // Get Event Staff Data
            var eventStaffRequest = this.ajax('getSFEventStaff', eventId);
            eventStaffRequest.done( this.updateUI_EventStaff );
            eventStaffRequest.fail( function(data) {  data.containerSelector = '.mjw-container-event-staff';      this.showInlineError(data);  } );

            // Get Event Equipment Data
            var eventEquipmentRequest = this.ajax('getSFEventEquipment', eventId);
            eventEquipmentRequest.done( this.updateUI_EventEquipment );
            eventEquipmentRequest.fail( function(data) {  data.containerSelector = '.mjw-container-event-equipment';  this.showInlineError(data);  } );
        }
    },
    
    showError: function(data) {  this.switchTo('error', data);  },
    showInlineError: function(data) {
        var container = this.$(data.containerSelector);
        var errorDiv = this.$('<div class="mjw-error"></div>');
        errorDiv.append('<p>There was a problem accessing the data.</p>');
        errorDiv.append('<br />');
        errorDiv.append('<div><strong>Technical Details: </strong><div class="mjw-technical-details">' + data.responseText + '</div></div>');
        container.html(errorDiv);
    },
    
    showNoOrganizationMessage: function(technicalDetails) {
        this.switchTo(
            'working_status', 
            {
                message:         'Sorrry, there is no organization associated with this ticket. Cannot find recent events.',
                technicalDetails: technicalDetails
            }
        );
    },




    // DOM Event Handlers
    setBPE: function(e) {
        e.preventDefault();
        var a = this.$(e.currentTarget);
        var bpe = a.data('bpe');

        // Update Ticket Field (BPE)
        var ticket = this.ticket();
        var fieldName = 'custom_field_' + this.BPE_FIELD_ID;
        ticket.customField(fieldName, bpe);

        // Switch to Single Event View
        var eve = a.data('stringified');
        var records = [];
        records.push(eve);
        this.showSalesforceEvents({ajaxResponse: {totalSize: 1, records: records}, template: 'display_event'});

        // Load Related Lists (Staff & Equipment)
    }
  };

}());
