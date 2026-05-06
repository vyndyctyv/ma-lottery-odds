# Load required libraries
library(shiny)
library(reticulate)
library(DT)
library(plotly)

# Set up Python environment
use_python(Sys.which("python"))

# Python modules (will be imported when needed)
pull_urls <- NULL
pull_ticket <- NULL
ticket_simulating <- NULL
pd <- NULL

# Function to calculate weighted average
calculate_weighted_average <- function(df) {
  # Convert to R for calculation
  r_df <- py_to_r(df)
  if (nrow(r_df) > 0 && "Prize" %in% colnames(r_df) && "Odds" %in% colnames(r_df)) {
    weighted_average <- sum(r_df$Prize * r_df$Odds) / sum(r_df$Odds)
    return(weighted_average)
  } else {
    return(NA)
  }
}

# Function to safely run simulation
safe_break_or_broke <- function(df, num_tickets, attempts) {
  tryCatch({
    # Import ticket_simulating if not already imported
    if (is.null(ticket_simulating)) {
      ticket_simulating <<- import("ticket_simulating")
    }
    
    result <- ticket_simulating$break_or_broke(df, as.integer(num_tickets), as.integer(attempts))
    return(result)
  }, error = function(e) {
    cat("Simulation error:", e$message, "\n")
    return(0)
  })
}

# UI
ui <- fluidPage(
  titlePanel("MA Lottery Odds Calculator"),
  
  tabsetPanel(
    # Main analysis tab
    tabPanel("Ticket Analysis",
      sidebarLayout(
        sidebarPanel(
          h3("Settings"),
          checkboxInput("use_existing", "Use existing ticket URLs", TRUE),
          actionButton("load_data", "Load Ticket Data", class = "btn-primary"),
          br(), br(),
          h4("Simulation Settings"),
          numericInput("num_tickets", "Number of Tickets:", 3, min = 1, max = 10),
          numericInput("num_attempts", "Number of Attempts:", 1000, min = 100, max = 10000),
          br(),
          actionButton("run_simulation", "Run Simulation", class = "btn-success")
        ),
        
        mainPanel(
          h3("Ticket Data"),
          verbatimTextOutput("status"),
          DTOutput("ticket_table"),
          h3("Individual Ticket Analysis"),
          selectInput("selected_ticket", "Select Ticket:", choices = NULL),
          DTOutput("individual_ticket_table"),
          h4("Ticket Details"),
          verbatimTextOutput("ticket_details")
        )
      )
    ),
    
    # Summary tab
    tabPanel("Summary",
      h3("All Ticket Averages"),
      DTOutput("summary_table"),
      h3("Visualization"),
      plotlyOutput("summary_plot")
    ),
    
    # Custom simulations tab
    tabPanel("Custom Simulations",
      sidebarLayout(
        sidebarPanel(
          h3("Custom Simulation"),
          selectInput("sim_ticket", "Select Ticket:", choices = NULL),
          numericInput("custom_tickets", "Number of Tickets:", 5, min = 1, max = 20),
          numericInput("custom_attempts", "Number of Attempts:", 100, min = 10, max = 1000),
          br(),
          actionButton("run_custom_sim", "Run Custom Simulation", class = "btn-warning"),
          br(), br(),
          h4("Simulation Results"),
          verbatimTextOutput("custom_sim_results")
        ),
        
        mainPanel(
          h3("Simulation Details"),
          verbatimTextOutput("sim_status")
        )
      )
    )
  )
)

# Server
server <- function(input, output, session) {
  # Reactive values
  values <- reactiveValues(
    ticket_urls = NULL,
    all_tickets = NULL,
    ticket_averages = NULL,
    selected_ticket_data = NULL
  )
  
  # Load ticket data
  observeEvent(input$load_data, {
    tryCatch({
      # Import Python modules on first use
      if (is.null(pull_urls)) {
        pull_urls <<- import("pull_urls")
      }
      if (is.null(pull_ticket)) {
        pull_ticket <<- import("pull_ticket")
      }
      if (is.null(ticket_simulating)) {
        ticket_simulating <<- import("ticket_simulating")
      }
      if (is.null(pd)) {
        pd <<- import("pandas")
      }
      
      # Update status
      output$status <- renderText({
        "Loading ticket data..."
      })
      
      # Pull ticket URLs
      if (input$use_existing && file.exists("ticket_urls.csv")) {
        values$ticket_urls <- pd$read_csv("ticket_urls.csv")
        status_text <- "Using existing ticket_urls.csv file"
      } else {
        status_text <- "Pulling fresh URLs from website..."
        urls <- pull_urls$pull_urls(pull_urls$tickets_url)
        df <- pd$DataFrame(urls)
        df$to_csv("ticket_urls.csv", index = FALSE)
        values$ticket_urls <- pd$read_csv("ticket_urls.csv")
        status_text <- paste(status_text, "\nFresh URLs pulled and saved to ticket_urls.csv")
      }
      
      # Pull ticket data
      status_text <- paste(status_text, "\nPulling ticket data...")
      values$all_tickets <- pull_ticket$pull_tickets(values$ticket_urls)
      
      # Update status
      output$status <- renderText({
        paste(status_text, "\nTicket data loaded successfully!")
      })
      
      # Update ticket selector
      ticket_names <- sapply(values$all_tickets, function(ticket) {
        if (!is.null(ticket)) ticket[[2]] else NULL
      })
      ticket_names <- ticket_names[!sapply(ticket_names, is.null)]
      
      updateSelectInput(session, "selected_ticket", choices = ticket_names)
      updateSelectInput(session, "sim_ticket", choices = ticket_names)
      
    }, error = function(e) {
      output$status <- renderText({
        paste("Error loading ticket data:", e$message)
      })
    })
  })
  
  # Process tickets and calculate averages
  ticket_averages_data <- eventReactive(input$load_data, {
    req(values$all_tickets)
    
    # Process each ticket
    ticket_averages <- list()
    index <- 0
    
    for (ticket in values$all_tickets) {
      if (!is.null(ticket)) {  # Check if ticket is valid
        df <- ticket[[1]]
        ticket_name <- ticket[[2]]
        
        # Calculate weighted average
        weighted_average <- calculate_weighted_average(df)
        
        # Store results
        ticket_averages[[length(ticket_averages) + 1]] <- list(
          Name = ticket_name,
          Average = weighted_average
        )
        
        index <- index + 1
      }
    }
    
    # Convert to dataframe
    if (length(ticket_averages) > 0) {
      ticket_df <- data.frame(
        Name = sapply(ticket_averages, function(x) x$Name),
        Average = sapply(ticket_averages, function(x) x$Average),
        stringsAsFactors = FALSE
      )
      
      # Sort by average
      ticket_df <- ticket_df[order(ticket_df$Average, decreasing = TRUE), ]
      values$ticket_averages <- ticket_df
    }
    
    return(values$ticket_averages)
  })
  
  # Display summary table
  output$summary_table <- renderDT({
    req(ticket_averages_data())
    datatable(ticket_averages_data(), options = list(pageLength = 20))
  })
  
  # Display summary plot
  output$summary_plot <- renderPlotly({
    req(ticket_averages_data())
    
    ticket_df <- ticket_averages_data()
    
    # Create plot
    p <- plot_ly(
      data = ticket_df,
      x = ~Name,
      y = ~Average,
      type = "bar",
      marker = list(color = "lightblue")
    ) %>%
      layout(
        title = "Ticket Averages",
        xaxis = list(title = "Ticket Name"),
        yaxis = list(title = "Average Value")
      )
    
    return(p)
  })
  
  # Display ticket table
  output$ticket_table <- renderDT({
    req(ticket_averages_data())
    datatable(ticket_averages_data(), options = list(pageLength = 10))
  })
  
  # Update individual ticket data when selected
  observeEvent(input$selected_ticket, {
    req(values$all_tickets)
    
    # Find the selected ticket
    selected_ticket <- NULL
    for (ticket in values$all_tickets) {
      if (!is.null(ticket) && ticket[[2]] == input$selected_ticket) {
        selected_ticket <- ticket
        break
      }
    }
    
    if (!is.null(selected_ticket)) {
      # Store ticket data
      values$selected_ticket_data <- selected_ticket[[1]]
      
      # Display ticket details
      output$ticket_details <- renderText({
        df <- selected_ticket[[1]]
        ticket_name <- selected_ticket[[2]]
        ticket_url <- selected_ticket[[3]]
        
        # Calculate weighted average
        weighted_average <- calculate_weighted_average(df)
        
        paste(
          "Ticket Name:", ticket_name, "\n",
          "Weighted Average: $", round(weighted_average, 2), "\n",
          "URL:", ticket_url
        )
      })
    }
  })
  
  # Display individual ticket table
  output$individual_ticket_table <- renderDT({
    req(values$selected_ticket_data)
    
    # Convert Python dataframe to R dataframe
    r_df <- py_to_r(values$selected_ticket_data)
    datatable(r_df, options = list(pageLength = 10))
  })
  
  # Run simulation
  observeEvent(input$run_simulation, {
    req(values$selected_ticket_data)
    
    output$sim_status <- renderText({
      "Running simulation..."
    })
    
    # Run simulation
    simulated_value <- safe_break_or_broke(
      values$selected_ticket_data, 
      input$num_tickets, 
      input$num_attempts
    )
    
    output$sim_status <- renderText({
      paste(
        "Simulation complete!\n",
        "Number of tickets:", input$num_tickets, "\n",
        "Number of attempts:", input$num_attempts, "\n",
        "Simulated value: $", round(simulated_value, 2)
      )
    })
  })
  
  # Run custom simulation
  observeEvent(input$run_custom_sim, {
    req(values$all_tickets)
    
    # Find the selected ticket
    selected_ticket <- NULL
    for (ticket in values$all_tickets) {
      if (!is.null(ticket) && ticket[[2]] == input$sim_ticket) {
        selected_ticket <- ticket
        break
      }
    }
    
    if (!is.null(selected_ticket)) {
      output$custom_sim_results <- renderText({
        "Running custom simulation..."
      })
      
      # Run simulation
      simulated_value <- safe_break_or_broke(
        selected_ticket[[1]], 
        input$custom_tickets, 
        input$custom_attempts
      )
      
      output$custom_sim_results <- renderText({
        paste(
          "Custom simulation complete!\n",
          "Ticket:", input$sim_ticket, "\n",
          "Number of tickets:", input$custom_tickets, "\n",
          "Number of attempts:", input$custom_attempts, "\n",
          "Simulated value: $", round(simulated_value, 2)
        )
      })
    } else {
      output$custom_sim_results <- renderText({
        "Error: Could not find selected ticket"
      })
    }
  })
}

# Run the Shiny app
shinyApp(ui = ui, server = server)