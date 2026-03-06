import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { UserRole } from 'src/schemas/user.schema';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { MongoIdDto, UserIdDto } from 'src/common/dto/mongoId.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import type { AuthUser } from 'src/common/interface/auth-user.interface';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * Get the profile of the currently authenticated user.
   *
   * @param user - The currently authenticated user, extracted from the JWT token using the @CurrentUser decorator. It contains the user's ID and other relevant information.
   * @returns An object containing a success message and the user's profile data, excluding sensitive information like the password.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyProfile(@CurrentUser() user: AuthUser) {
    return this.userService.getUserProfile(user.userId);
  }

  /**
   * Update the profile of the currently authenticated user.
   *
   * @param user - The currently authenticated user, extracted from the JWT token using the @CurrentUser decorator. It contains the user's ID and other relevant information.
   * @param updateUserDto - An object containing the fields that the user wants to update in their profile, such as name, phone, etc. This data is validated against the UpdateUserDto class.
   * @returns An object containing a success message and the updated user's profile data, excluding sensitive information like the password.
   */
  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateMyProfile(
    @CurrentUser() user: AuthUser,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.updateMyProfile(user.userId, updateUserDto);
  }

  /**
   * Get a paginated list of all users in the system, with optional search functionality.
   *
   * @param query - An object containing pagination parameters (page, limit) and an optional search string to filter users by name or email. This data is validated against the PaginationDto class.
   * @returns An object containing a success message, an array of user profiles matching the search criteria (if provided), and pagination metadata such as total items, total pages, current page, and items per page.
   * @throws NotFoundException if no users are found matching the search criteria.
   * @throws BadRequestException if the provided pagination parameters are invalid (e.g., negative page number or limit).
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get()
  findAllUsers(@Query() query: PaginationDto) {
    return this.userService.findAllUsers(query);
  }

  /**
   * Get the profile of a specific user by their ID. This endpoint is restricted to admin users only.
   *
   * @param param - An object containing the ID of the user to be retrieved, extracted from the URL parameter. This ID is validated to ensure it is a valid MongoDB ObjectId using the MongoIdDto class.
   * @returns An object containing a success message and the user's profile data, excluding sensitive information like the password.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided ID is not a valid MongoDB ObjectId.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get(':id')
  findUserById(@Param() param: MongoIdDto) {
    return this.userService.findUserById(param.id);
  }

  /**
   * Delete a specific user by their ID. This endpoint is restricted to admin users only and cannot be used to delete the admin's own account.
   *
   * @param param - An object containing the ID of the user to be deleted, extracted from the URL parameter. This ID is validated to ensure it is a valid MongoDB ObjectId using the MongoIdDto class.
   * @returns An object containing a success message confirming the deletion of the user.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided ID is not a valid MongoDB ObjectId.
   * @throws ForbiddenException if an admin attempts to delete their own account.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  removeUserByAdmin(@Param() param: MongoIdDto) {
    return this.userService.removeUserByAdmin(param.id);
  }

  /**
   * Toggle the suspension status of a specific user by their ID. This endpoint is restricted to admin users only and cannot be used to suspend or unsuspend the admin's own account.
   *
   * @param param - An object containing the ID of the user whose suspension status is to be toggled, extracted from the URL parameter. This ID is validated to ensure it is a valid MongoDB ObjectId using the MongoIdDto class.
   * @returns An object containing a success message confirming the suspension status toggle of the user.
   * @throws NotFoundException if the user with the given ID does not exist in the database.
   * @throws BadRequestException if the provided ID is not a valid MongoDB ObjectId.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/suspend-toggle')
  suspendToggleByAdmin(@Param() param: MongoIdDto) {
    return this.userService.suspendToggleByAdmin(param.id);
  }
}
