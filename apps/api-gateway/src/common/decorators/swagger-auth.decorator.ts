import {
    applyDecorators,
  } from '@nestjs/common';
  
  import {
    ApiBearerAuth,
    ApiUnauthorizedResponse,
  } from '@nestjs/swagger';
  
  export function SwaggerAuth() {
  
    return applyDecorators(
  
      ApiBearerAuth(
        'JWT-auth',
      ),
  
      ApiUnauthorizedResponse({
  
        description:
          'Unauthorized',
  
      }),
  
    );
  
  }